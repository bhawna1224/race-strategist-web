# Race Strategist Web

A real backend + frontend, not a single static file. This is the deployable
version of the Autonomous Race Strategist Agent project -- see the main
project README for the full Phase 1-5 writeup and the Italian GP case
study this is built on.

## Architecture

```
race-strategist-web/
├── backend/
│   ├── app/
│   │   ├── main.py       # FastAPI app: API routes + serves the frontend
│   │   ├── openf1.py     # OpenF1 API client (runs server-side --
│   │   │                 # this is why a backend exists: OpenF1 has no
│   │   │                 # CORS support, so a browser can't call it
│   │   │                 # directly for an arbitrary race)
│   │   ├── model.py      # Data pull + tyre-degradation model fitting
│   │   │                 # (same validated logic as export_race_model.py)
│   │   ├── simulate.py   # The general simulate_strategy engine
│   │   └── cache.py      # In-memory cache so a race is only fetched once
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js            # Calls the backend via fetch(), no embedded data
└── render.yaml            # Render deployment config
```

Frontend and backend are served from **one process** (FastAPI mounts the
frontend as static files), so there's a single deploy target and no CORS
configuration needed between them.

## Why a backend at all

The static-site version of this project (see `/website` in the main repo)
worked by embedding a handful of pre-fetched races as JSON directly in the
page. That's genuinely $0 and needs no server -- but it can only offer
races someone fetched ahead of time, because OpenF1 doesn't support CORS
and a browser can't call it directly for an arbitrary race.

This version's backend calls OpenF1 server-side (no CORS restriction
applies there), so **any race OpenF1 has data for** can be picked, pulled,
and fit on the spot -- not just a curated list.

## Running locally

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open http://localhost:8000 -- the same process serves both the API
and the frontend.

## API

- `GET /api/races?year=2026` -- list of race weekends for that year
- `GET /api/race/{year}/{country}` -- fitted model for that race (pulled
  and fit on first request, cached after that)
- `POST /api/simulate` -- body `{year, country, driver_number, pit_laps,
  compounds}`, returns the predicted total race time and lap-by-lap
  breakdown

## Deploying (Render, free tier)

1. Push this repo to GitHub.
2. In Render, "New Web Service" -> connect the repo -> it should detect
   `render.yaml` automatically. If not, set manually:
   - Build command: `pip install -r backend/requirements.txt`
   - Start command: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Deploy. First load after idle time will be slow (~30-50s) -- Render's
   free tier sleeps a service after 15 minutes of inactivity. This is the
   real cost of "free backend hosting" and worth knowing about upfront.

## Known limitations, stated honestly

- **Cold starts.** See above -- free-tier sleep/wake is a real UX cost,
  not hidden in this README.
- **In-memory cache resets on restart.** A sleeping/restarting free
  instance loses its cache; the next request for that race just re-fetches
  and re-fits it (a few seconds), not a correctness issue.
- **No persistent storage.** Nothing is saved between server restarts.
  For a project at this scale that's a reasonable tradeoff, not an
  oversight -- a database would add real complexity for no benefit here,
  since every cached value is trivially re-derivable from OpenF1 on demand.
