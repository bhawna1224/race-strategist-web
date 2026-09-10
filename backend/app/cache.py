"""
Simple in-memory cache, keyed by (year, country). Fitting a race's model
involves ~6 OpenF1 API calls and some real computation -- there's no
reason to redo that on every request for the same race.

This is intentionally simple (a plain dict, no expiry) rather than
introducing Redis or a database: race results don't change once a race
has happened, so there's nothing to invalidate. If the process restarts,
the cache is empty again and repopulates on demand -- that's an
acceptable tradeoff for a free-tier deployment that may sleep and restart
anyway.
"""

_cache: dict[tuple[int, str], dict] = {}


def get(year: int, country: str):
    return _cache.get((year, country.lower()))


def set(year: int, country: str, value: dict):
    _cache[(year, country.lower())] = value


def all_cached_races():
    return list(_cache.values())
