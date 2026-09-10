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
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SECONDS)
    return resp.json()


def resolve_race_session(year: int, country: str):
    """Find the meeting and Race session for a given year + country."""
    meetings = get("meetings", year=year, country_name=country)
    if not meetings:
        raise ValueError(f"No meeting found for {country} {year}")
    meeting = meetings[0]
    sessions = get("sessions", meeting_key=meeting["meeting_key"], session_name="Race")
    if not sessions:
        raise ValueError(f"No Race session found for {meeting['meeting_official_name']}")
    return meeting, sessions[0]


def list_meetings(year: int):
    """All meetings (race weekends) for a given year -- used to populate
    the frontend's race picker with genuinely any race, not a fixed list."""
    return get("meetings", year=year)
