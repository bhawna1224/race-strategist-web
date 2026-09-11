"""
Thin client for the OpenF1 API (https://openf1.org).

This runs server-side, which is the whole reason a backend exists here:
OpenF1 doesn't support CORS, so a browser can't call it directly for an
arbitrary race. A server has no such restriction.
"""

import time
import requests

BASE_URL = "https://api.openf1.org/v1"
REQUEST_DELAY_SECONDS = 0.4  # stay well under the free-tier 3 req/s cap


def get(endpoint: str, **params):
    resp = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=30)
    if resp.status_code == 404:
        # OpenF1 normally returns 200 + an empty list for a filtered query
        # with no matches, but occasionally 404s outright for a resource
        # with zero records of any kind (e.g. a meeting that was
        # scheduled but never actually held any sessions, such as a
        # cancelled race). Normalize that to "no results" so callers can
        # handle it the same way as any other empty response, rather than
        # every call site needing to know about this specific quirk.
        time.sleep(REQUEST_DELAY_SECONDS)
        return []
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SECONDS)
    return resp.json()


def resolve_race_session(year: int, country: str):
    """
    Find the Race session for a given year + country.

    IMPORTANT: this queries /sessions directly with session_name="Race",
    rather than going through /meetings first and taking the first
    result. OpenF1 records pre-season testing days as their own
    "meetings" too -- for a country like Bahrain (whose actual 2026 GP
    was cancelled but which still hosted testing), taking meetings[0]
    picked up "ARAMCO PRE-SEASON TESTING 1 2026" instead of a race
    weekend. Filtering sessions directly by session_name="Race" sidesteps
    that ambiguity by asking for exactly what we want from the start.
    """
    sessions = get("sessions", year=year, country_name=country, session_name="Race")
    if not sessions:
        raise ValueError(
            f"No Race session data found for {country} {year}. "
            f"This usually means the race hasn't happened yet, or was cancelled."
        )
    session = sessions[0]
    meetings = get("meetings", meeting_key=session["meeting_key"])
    meeting = meetings[0] if meetings else {
        "meeting_key": session["meeting_key"],
        "meeting_official_name": f"{country} Grand Prix {year}",
        "country_name": country,
        "circuit_short_name": session.get("circuit_short_name", ""),
    }
    return meeting, session


def list_meetings(year: int):
    """All meetings (race weekends) for a given year -- used to populate
    the frontend's race picker with genuinely any race, not a fixed list."""
    return get("meetings", year=year)
