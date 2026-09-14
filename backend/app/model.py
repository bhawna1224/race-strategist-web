"""
Race data pull + tyre-degradation model fitting.

This is the same logic as export_race_model.py (the standalone script used
earlier in this project), now running inside the backend so it can fit a
model for ANY race on demand, not just a pre-fetched curated list. Every
function here has already been validated against real race data -- see
the project's phase2_backtest_engine.py and export_race_model.py for the
original development and validation history.
"""

import numpy as np
import pandas as pd

from . import openf1

OUTLIER_LAP_RATIO = 1.15
MIN_LAPS_FOR_FIT = 8


def find_neutralized_laps_and_costs(race_control: list, laps_df: pd.DataFrame):
    """Finds ALL SessionStatus ABORTED->STARTED windows (zero, one, or
    more) and assigns each neutralized lap a fixed cost equal to that lap
    number's field-median duration."""
    rc_df = pd.DataFrame(race_control)
    neutralized_laps = set()
    if not rc_df.empty and "message" in rc_df.columns:
        rc_df = rc_df.sort_values("date").reset_index(drop=True)
        is_status = rc_df["category"] == "SessionStatus"
        msg_upper = rc_df["message"].astype(str).str.upper()
        suspended_mask = is_status & msg_upper.str.contains("ABORTED")
        resumed_mask = is_status & msg_upper.str.contains("STARTED")

        for _, sus_row in rc_df[suspended_mask].iterrows():
            sus_lap = sus_row["lap_number"]
            later = rc_df[rc_df["date"] > sus_row["date"]]
            resume_candidates = later[resumed_mask.loc[later.index]]
            resume_lap = resume_candidates.iloc[0]["lap_number"] if not resume_candidates.empty else sus_lap
            if pd.notna(sus_lap) and pd.notna(resume_lap):
                neutralized_laps.update(range(int(sus_lap), int(resume_lap) + 1))

    fixed_lap_costs = {}
    for lap in neutralized_laps:
        med = laps_df.loc[laps_df["lap_number"] == lap, "lap_duration"].median()
        if pd.notna(med):
            fixed_lap_costs[int(lap)] = round(float(med), 3)

    return neutralized_laps, fixed_lap_costs


def attach_tyre_age(laps_df, stints_df):
    laps_df = laps_df.copy()
    laps_df["compound"] = None
    laps_df["tyre_age"] = np.nan
    laps_df["stint_number"] = np.nan
    for _, stint in stints_df.iterrows():
        mask = (
            (laps_df["driver_number"] == stint["driver_number"])
            & (laps_df["lap_number"] >= stint["lap_start"])
            & (laps_df["lap_number"] <= stint["lap_end"])
        )
        laps_df.loc[mask, "compound"] = stint["compound"]
        laps_df.loc[mask, "stint_number"] = stint["stint_number"]
        laps_df.loc[mask, "tyre_age"] = (
            laps_df.loc[mask, "lap_number"] - stint["lap_start"] + stint["tyre_age_at_start"]
        )
    return laps_df


def mark_clean_laps(laps_df, pit_df, neutralized_laps):
    laps_df = laps_df.copy()
    laps_df["is_neutralized"] = laps_df["lap_number"].isin(neutralized_laps)
    genuine_pit_laps = set(
        zip(pit_df.loc[~pit_df["lap_number"].isin(neutralized_laps), "driver_number"],
            pit_df.loc[~pit_df["lap_number"].isin(neutralized_laps), "lap_number"])
    )
    laps_df["is_pit_in_lap"] = laps_df.apply(
        lambda r: (r["driver_number"], r["lap_number"]) in genuine_pit_laps, axis=1
    )
    laps_df["is_clean_candidate"] = (
        (~laps_df["is_neutralized"]) & (~laps_df["is_pit_out_lap"]) & (~laps_df["is_pit_in_lap"])
        & laps_df["compound"].notna()
    )
    laps_df["is_clean"] = False
    for driver, group in laps_df[laps_df["is_clean_candidate"]].groupby("driver_number"):
        median_pace = group["lap_duration"].median()
        good = group["lap_duration"] <= OUTLIER_LAP_RATIO * median_pace
        laps_df.loc[good[good].index, "is_clean"] = True
    return laps_df


def fit_stint_degradation(clean_laps, min_laps=MIN_LAPS_FOR_FIT):
    clean_laps = clean_laps.dropna(subset=["compound", "stint_number", "tyre_age"])
    rows = []
    for (driver, stint_num), group in clean_laps.groupby(["driver_number", "stint_number"]):
        if len(group) < min_laps:
            continue
        x = group["tyre_age"].values.astype(float)
        y = group["lap_duration"].values.astype(float)
        slope, intercept = np.polyfit(x, y, 1)
        rows.append({"driver_number": driver, "compound": group["compound"].iloc[0],
                     "n_laps": len(group), "intercept": intercept, "slope": slope})
    return pd.DataFrame(rows)


def compute_degradation_rates(stint_fits):
    rates = {}
    for compound, group in stint_fits.groupby("compound"):
        weighted_slope = np.average(group["slope"], weights=group["n_laps"])
        rates[compound] = max(0.0, float(weighted_slope))
    return rates


def compute_compound_offsets(stint_fits):
    """
    Graph-based offset computation: routes each compound's offset to the
    best-connected anchor via whatever driver overlap exists, instead of
    assuming direct overlap with one fixed anchor (which breaks when e.g.
    the drivers who ran SOFT never ran HARD long enough to fit -- caught
    via real data during this project's development).
    """
    compounds = sorted(stint_fits["compound"].unique())
    intercept_by_driver = {
        c: stint_fits[stint_fits["compound"] == c].groupby("driver_number")["intercept"].mean()
        for c in compounds
    }
    pairwise = {}
    for a in compounds:
        for b in compounds:
            if a == b:
                continue
            common = set(intercept_by_driver[a].index) & set(intercept_by_driver[b].index)
            if common:
                deltas = [intercept_by_driver[b][d] - intercept_by_driver[a][d] for d in common]
                pairwise[(a, b)] = float(np.mean(deltas))

    if not pairwise:
        anchor = compounds[0]
        return {c: 0.0 for c in compounds}, anchor

    connectivity = {c: sum(1 for (a, b) in pairwise if a == c or b == c) for c in compounds}
    total_laps = stint_fits.groupby("compound")["n_laps"].sum().to_dict()
    anchor = max(compounds, key=lambda c: (connectivity[c], total_laps.get(c, 0)))

    offsets = {anchor: 0.0}
    frontier = [anchor]
    while frontier:
        current = frontier.pop()
        for c in compounds:
            if c in offsets:
                continue
            if (current, c) in pairwise:
                offsets[c] = offsets[current] + pairwise[(current, c)]
                frontier.append(c)
            elif (c, current) in pairwise:
                offsets[c] = offsets[current] - pairwise[(c, current)]
                frontier.append(c)

    for c in compounds:
        if c not in offsets:
            offsets[c] = 0.0

    return offsets, anchor


def compute_per_driver_base_pace(stint_fits, offsets, anchor, all_compounds, drivers_df):
    result = {}
    for _, drow in drivers_df.iterrows():
        driver = drow["driver_number"]
        driver_fits = stint_fits[stint_fits["driver_number"] == driver]
        if driver_fits.empty:
            continue
        if anchor in driver_fits["compound"].values:
            anchor_pace = np.average(
                driver_fits.loc[driver_fits["compound"] == anchor, "intercept"],
                weights=driver_fits.loc[driver_fits["compound"] == anchor, "n_laps"],
            )
        else:
            fallback_compound = driver_fits.iloc[0]["compound"]
            fallback_pace = driver_fits.loc[driver_fits["compound"] == fallback_compound, "intercept"].mean()
            anchor_pace = fallback_pace - offsets.get(fallback_compound, 0.0)

        result[str(int(driver))] = {
            "name": drow.get("name_acronym", str(driver)),
            "team": drow.get("team_name", ""),
            "base_pace": {c: round(anchor_pace + offsets.get(c, 0.0), 4) for c in all_compounds},
        }
    return result


def compute_actual_strategies(stints_df, session_results: dict) -> dict:
    """
    Reconstruct each driver's REAL historical strategy from their actual
    stint sequence (not the fitted degradation model -- this uses every
    real stint, clean or not, since we want what they actually did, not
    what's usable for curve-fitting). Converts to the same
    (pit_laps, compounds) format simulate_strategy expects, so any
    driver's real strategy can be re-run through the model for a
    real-vs-predicted comparison.

    session_results: dict of {driver_number: duration_seconds_or_None},
    the official recorded race time, used for the real-vs-actual
    comparison. None for drivers who didn't finish or have no recorded
    duration (DNFs, disqualifications) -- the frontend should treat that
    as "no comparison available," not zero.
    """
    result = {}
    for driver, group in stints_df.groupby("driver_number"):
        stints = group.sort_values("stint_number")
        compounds = stints["compound"].tolist()
        pit_laps = stints["lap_end"].tolist()[:-1]  # every stint's end lap except the last
        result[str(int(driver))] = {
            "pit_laps": [int(p) for p in pit_laps],
            "compounds": compounds,
            "actual_time_seconds": session_results.get(int(driver)),
        }
    return result


def build_race_model(year: int, country: str) -> dict:
    """Pull data for one race and fit its model. This is the function
    the /api/race endpoint calls -- it's the live, on-demand version of
    running export_race_model.py by hand."""
    meeting, session = openf1.resolve_race_session(year, country)
    session_key = session["session_key"]

    drivers = openf1.get("drivers", session_key=session_key)
    laps = openf1.get("laps", session_key=session_key)
    stints = openf1.get("stints", session_key=session_key)
    pits = openf1.get("pit", session_key=session_key)
    race_control = openf1.get("race_control", session_key=session_key)
    session_results_raw = openf1.get("session_result", session_key=session_key)

    drivers_df = pd.DataFrame(drivers)[["driver_number", "name_acronym", "team_name"]].drop_duplicates(subset="driver_number")
    laps_df = pd.DataFrame(laps)
    stints_df = pd.DataFrame(stints)
    pit_df = pd.DataFrame(pits)

    if laps_df.empty:
        raise ValueError(f"No lap data available yet for {country} {year} (race may not have happened yet).")

    total_laps = int(laps_df["lap_number"].max())

    neutralized_laps, fixed_lap_costs = find_neutralized_laps_and_costs(race_control, laps_df)

    laps_df = attach_tyre_age(laps_df, stints_df)
    laps_df = mark_clean_laps(laps_df, pit_df, neutralized_laps)
    clean_laps = laps_df[laps_df["is_clean"]]

    stint_fits = fit_stint_degradation(clean_laps)
    if stint_fits.empty:
        raise ValueError(f"Not enough clean lap data to fit a model for {country} {year}.")

    deg_rates = compute_degradation_rates(stint_fits)
    offsets, anchor = compute_compound_offsets(stint_fits)
    all_compounds = sorted(stint_fits["compound"].unique())
    per_driver_pace = compute_per_driver_base_pace(stint_fits, offsets, anchor, all_compounds, drivers_df)

    genuine_stops = pit_df[~pit_df["lap_number"].isin(neutralized_laps)]
    pit_loss_seconds = float(genuine_stops["lane_duration"].median()) if not genuine_stops.empty else 25.0

    # Real official finishing time per driver, keyed by driver_number.
    # None for drivers with no recorded duration (DNF/DSQ) -- see
    # compute_actual_strategies' docstring for how the frontend should
    # treat that.
    session_results = {
        r["driver_number"]: r.get("duration")
        for r in session_results_raw
        if r.get("duration") is not None
    }
    actual_strategies = compute_actual_strategies(stints_df, session_results)

    # Merge the real strategy + real time into each driver's entry, so
    # the frontend gets everything about a driver from one place.
    for driver_key, actual in actual_strategies.items():
        if driver_key in per_driver_pace:
            per_driver_pace[driver_key]["actual_strategy"] = {
                "pit_laps": actual["pit_laps"],
                "compounds": actual["compounds"],
            }
            per_driver_pace[driver_key]["actual_time_seconds"] = actual["actual_time_seconds"]

    return {
        "race_name": meeting["meeting_official_name"],
        "country": meeting["country_name"],
        "circuit": meeting["circuit_short_name"],
        "year": year,
        "session_key": session_key,
        "total_laps": total_laps,
        "neutralized_laps": sorted(int(l) for l in neutralized_laps),
        "fixed_lap_costs": {str(k): v for k, v in fixed_lap_costs.items()},
        "compounds": all_compounds,
        "deg_rates": deg_rates,
        "pit_loss_seconds": round(pit_loss_seconds, 2),
        "drivers": per_driver_pace,
    }
