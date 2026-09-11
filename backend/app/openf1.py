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
MAX_RETRIES = 4


def get(endpoint: str, **params):
    """
    GET from OpenF1, with retry-with-backoff specifically for 429 (rate
    limited) responses. A single race pull makes ~7 sequential calls; the
    fixed delay between them normally stays under OpenF1's free-tier
    limit, but a transient rate-limit hit (e.g. from concurrent requests,
    a platform health check, or repeated manual testing in a short
    window) shouldn't fail the whole request outright when simply waiting
    and retrying would succeed.
    """
    url = f"{BASE_URL}/{endpoint}"
    last_error = None
    for attempt in range(MAX_RETRIES):
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            retry_after = float(resp.headers.get("Retry-After", 2 ** attempt))
            time.sleep(retry_after)
            last_error = requests.exceptions.HTTPError(
                f"429 Too Many Requests for url: {resp.url}"
            )
            continue
        if resp.status_code == 404:
            # See resolve_race_session's docstring: OpenF1 sometimes 404s
            # a resource with zero records instead of returning 200+[].
            time.sleep(REQUEST_DELAY_SECONDS)
            return []
        resp.raise_for_status()
        time.sleep(REQUEST_DELAY_SECONDS)
        return resp.json()

    raise last_error or RuntimeError(f"Failed to fetch {url} after {MAX_RETRIES} attempts")


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
