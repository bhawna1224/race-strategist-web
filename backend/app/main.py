"""
FastAPI backend for the Autonomous Race Strategist Agent website.

Serves both:
    - the REST API under /api/*
    - the static frontend (index.html, style.css, app.js) at /

...from one process, so this deploys as a single free-tier web service
with no CORS complications (frontend and API share an origin).

Run locally:
    pip install -r requirements.txt
    uvicorn app.main:app --reload

Endpoints:
    GET  /api/races?year=2026          -> list of meetings for that year
                                           (genuinely any race OpenF1 has,
                                           not a fixed curated list)
    GET  /api/race/{year}/{country}    -> fitted model for that race
                                           (pulled + fit on demand, cached
                                           after the first request)
    POST /api/simulate                 -> run a strategy against a race's
                                           fitted model
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import cache, model, openf1
from .simulate import simulate_strategy

app = FastAPI(title="Race Strategist API")

# CORS is only needed if you run the frontend separately from the backend
# during development (e.g. a local dev server on a different port). When
# deployed as one service (frontend served by this same app), requests
# are same-origin and this middleware does nothing meaningful -- it's
# here for local dev flexibility, not because production needs it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/races")
def list_races(year: int = 2026):
    """All race weekends for a given year, so the frontend can offer
    genuinely any race, not a fixed list."""
    try:
        meetings = openf1.list_meetings(year)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach OpenF1: {e}")
    return [
        {
            "year": year,
            "country": m["country_name"],
            "circuit": m["circuit_short_name"],
            "name": m["meeting_official_name"],
            "date": m["date_start"],
        }
        for m in meetings
    ]


@app.get("/api/race/{year}/{country}")
def get_race(year: int, country: str):
    """Fitted model for one race. Cached after the first request."""
    cached = cache.get(year, country)
    if cached is not None:
        return cached
    try:
        race_model = model.build_race_model(year, country)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error building model: {e}")
    cache.set(year, country, race_model)
    return race_model


class SimulateRequest(BaseModel):
    year: int
    country: str
    driver_number: int
    pit_laps: list[int]
    compounds: list[str]


@app.post("/api/simulate")
def post_simulate(req: SimulateRequest):
    """Run a strategy against a race's fitted model. Fetches/fits the
    race first if it isn't already cached."""
    race_model = cache.get(req.year, req.country)
    if race_model is None:
        try:
            race_model = model.build_race_model(req.year, req.country)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error building model: {e}")
        cache.set(req.year, req.country, race_model)

    result = simulate_strategy(race_model, req.driver_number, req.pit_laps, req.compounds)
    return result


# --- Serve the built React frontend from the same process -------------
# This must be mounted LAST, after the /api routes, so it doesn't shadow
# them (StaticFiles with html=True serves index.html for unmatched paths).
# Note: this now points at frontend/dist (the Vite build output), not the
# frontend/ source directory -- see render.yaml for the build step that
# produces it.
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
