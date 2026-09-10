"""
The general simulate_strategy engine, running server-side in real Python
(not a JS reimplementation this time -- the frontend just calls this via
the API). This is the same algorithm validated earlier in the project
(see export_race_model.py and the website's original client-side port,
both cross-checked against the Phase 2 validated Italy result of
6481.22s before this backend existed).

Design:
    - pit_laps: ANY lap where the strategy changes tyres.
      len(compounds) must equal len(pit_laps) + 1.
    - Any lap inside race_model["neutralized_laps"] gets that lap's fixed,
      pre-computed cost, regardless of compound or strategy.
    - A voluntary stop landing on/adjacent to a neutralized lap is FREE.
    - Base pace and degradation rates come from race_model, fit
      specifically for the requested driver and race.
"""


def _format_seconds(total_seconds: float) -> str:
    s = total_seconds
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    if h > 0:
        return f"{int(h)}h {int(m)}m {s:05.2f}s"
    return f"{int(m)}m {s:05.2f}s"


def simulate_strategy(race_model: dict, driver_number: int,
                       pit_laps: list[int], compounds: list[str]) -> dict:
    driver = race_model["drivers"].get(str(driver_number))
    if driver is None:
        return {"error": f"No fitted data for driver #{driver_number} in this race."}

    total_laps = race_model["total_laps"]
    neutralized = set(race_model["neutralized_laps"])
    fixed_costs = race_model["fixed_lap_costs"]
    deg_rates = race_model["deg_rates"]
    base_pace = driver["base_pace"]

    expected_stints = len(pit_laps) + 1
    if len(compounds) != expected_stints:
        return {"error": f"Expected {expected_stints} compounds for {len(pit_laps)} "
                          f"voluntary pit stop(s), got {len(compounds)}."}

    for lap in pit_laps:
        if not (1 <= lap <= total_laps - 1):
            return {"error": f"Pit lap {lap} must be between 1 and {total_laps - 1} "
                              f"(this race is {total_laps} laps)."}

    if sorted(pit_laps) != pit_laps or len(set(pit_laps)) != len(pit_laps):
        return {"error": "Pit-stop laps must be listed in strictly increasing order with no repeats."}

    for c in compounds:
        if c not in race_model["compounds"]:
            return {"error": f"{race_model['circuit']} doesn't have fitted data for {c} "
                              f"in this race. Available: {', '.join(race_model['compounds'])}."}

    bounds = [1] + [p + 1 for p in pit_laps] + [total_laps + 1]
    lap_by_lap = []
    total = 0.0

    for s, compound in enumerate(compounds):
        start, end = bounds[s], bounds[s + 1] - 1
        for lap in range(start, end + 1):
            is_neutralized = lap in neutralized
            if is_neutralized:
                cost = fixed_costs[str(lap)]
            else:
                tyre_age = lap - start
                cost = base_pace[compound] + deg_rates.get(compound, 0.0) * tyre_age
            lap_by_lap.append({"lap": lap, "compound": compound, "seconds": cost,
                                "neutralized": is_neutralized})
            total += cost

    for p in pit_laps:
        free = p in neutralized or (p + 1) in neutralized
        if not free:
            total += race_model["pit_loss_seconds"]

    return {
        "total_time_seconds": total,
        "total_time_str": _format_seconds(total),
        "pit_laps": pit_laps,
        "compounds": compounds,
        "lap_by_lap": lap_by_lap,
    }
