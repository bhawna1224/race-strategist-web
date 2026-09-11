import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TextEffect } from './components/motion-primitives/text-effect';
import { AnimatedNumber } from './components/motion-primitives/animated-number';

const COMPOUND_LABELS = { SOFT: 'Soft', MEDIUM: 'Medium', HARD: 'Hard' };
const DEFAULT_YEAR = 2026;
const ITALY_ANTONELLI_REAL = { pitLaps: [3, 28], compounds: ['HARD', 'MEDIUM', 'MEDIUM'] };
const ITALY_ANTONELLI_AGENT = { pitLaps: [3], compounds: ['SOFT', 'MEDIUM'] };

function formatSeconds(totalSeconds) {
  let s = totalSeconds;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (h > 0) return `${h}h ${m}m ${s.toFixed(2)}s`;
  return `${m}m ${s.toFixed(2)}s`;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export default function App() {
  const [races, setRaces] = useState([]);
  const [country, setCountry] = useState('Italy');
  const [raceModel, setRaceModel] = useState(null);
  const [driver, setDriver] = useState(12);
  const [numStops, setNumStops] = useState(2);
  const [pitLaps, setPitLaps] = useState([3, 28]);
  const [compounds, setCompounds] = useState(['HARD', 'MEDIUM', 'MEDIUM']);
  const [result, setResult] = useState(null);
  const [realResult, setRealResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load the race list once on mount.
  useEffect(() => {
    api(`/api/races?year=${DEFAULT_YEAR}`)
      .then(setRaces)
      .catch(() => setRaces([{ country: 'Italy', circuit: 'Monza' }]));
  }, []);

  // Load a race's fitted model whenever the selected country changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/api/race/${DEFAULT_YEAR}/${encodeURIComponent(country)}`)
      .then(model => {
        setRaceModel(model);
        const driverKeys = Object.keys(model.drivers);
        if (!model.drivers[String(driver)]) setDriver(parseInt(driverKeys[0], 10));
      })
      .catch(e => setError(`Couldn't load ${country}: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const runSimulation = useCallback(async () => {
    if (!raceModel) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: DEFAULT_YEAR, country, driver_number: driver,
          pit_laps: pitLaps, compounds,
        }),
      });
      if (r.error) { setError(r.error); setResult(null); return; }
      setResult(r);
      if (country === 'Italy' && driver === 12) {
        const rr = await api('/api/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: DEFAULT_YEAR, country: 'Italy', driver_number: 12,
            pit_laps: ITALY_ANTONELLI_REAL.pitLaps, compounds: ITALY_ANTONELLI_REAL.compounds,
          }),
        });
        setRealResult(rr);
      } else {
        setRealResult(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [raceModel, country, driver, pitLaps, compounds]);

  useEffect(() => {
    if (raceModel) runSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceModel, driver]);

  const setStops = (n) => {
    setNumStops(n);
    const spacing = raceModel ? Math.floor(raceModel.total_laps / (n + 1)) : 20;
    setPitLaps(prev => Array.from({ length: n }, (_, i) => prev[i] || spacing * (i + 1)));
    setCompounds(prev => Array.from({ length: n + 1 }, (_, i) => prev[i] || raceModel?.compounds[0] || 'MEDIUM'));
  };

  const loadPreset = (preset) => {
    setNumStops(preset.pitLaps.length);
    setPitLaps(preset.pitLaps);
    setCompounds(preset.compounds);
  };

  useEffect(() => {
    if (raceModel) runSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitLaps, compounds]);

  const isItalyAntonelli = country === 'Italy' && driver === 12;

  return (
    <div className="min-h-screen">
      <div className="border-b" style={{ borderColor: 'var(--panel-border)' }}>
        <div className="max-w-5xl mx-auto px-6 py-3.5 flex justify-between items-baseline flex-wrap gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            2026 Italian Grand Prix &middot; Monza &middot; 53 laps
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--green)' }}>
            Model validated &mdash; &minus;2.91% vs. actual
          </span>
        </div>
      </div>

      <header className="max-w-5xl mx-auto px-6 pt-16 pb-10">
        <p className="text-lg mb-4" style={{ color: 'var(--text-muted)' }}>
          Car #12 &middot; Kimi Antonelli &middot; Mercedes
        </p>
        <TextEffect
          as="h1"
          per="word"
          preset="fade-in-blur"
          className="font-display max-w-3xl"
          style={{ fontSize: 'clamp(40px,6vw,68px)' }}
        >
          He started P19. A red flag reshuffled the whole race. He won it on a tyre gamble.
        </TextEffect>
        <p className="text-lg mt-5 max-w-xl" style={{ color: 'var(--text-muted)' }}>
          An autonomous strategist that proposes pit-stop strategies, tests each one against a
          model fit from real race data, and refines its guess. Pick any race below &mdash;
          the backend pulls and fits the model live.
        </p>

        <div className="mt-11 grid grid-cols-1 sm:grid-cols-2 border" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="p-6 border-b sm:border-b-0 sm:border-r" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Real team's strategy &middot; model's prediction</div>
            <div className="font-display" style={{ fontSize: 'clamp(28px,4vw,40px)' }}>1h 48m 01.22s</div>
          </div>
          <div className="p-6">
            <div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Best strategy the agent found</div>
            <div className="font-display" style={{ fontSize: 'clamp(28px,4vw,40px)', color: 'var(--green)' }}>1h 47m 31.52s</div>
          </div>
        </div>
      </header>

      <section className="border-t max-w-5xl mx-auto px-6 py-14" style={{ borderColor: 'var(--panel-border)' }}>
        <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Try it yourself &mdash; live backend</p>
        <h2 className="font-display mb-4" style={{ fontSize: 'clamp(28px,4vw,38px)' }}>Build a pit-stop strategy for any 2026 race</h2>

        <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] border mt-8" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="p-7 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Race</label>
              <select value={country} onChange={e => setCountry(e.target.value)}>
                {races.map(r => <option key={r.country} value={r.country}>{r.circuit} ({r.country})</option>)}
              </select>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Driver</label>
              <select value={driver} onChange={e => setDriver(parseInt(e.target.value, 10))} disabled={!raceModel}>
                {raceModel && Object.entries(raceModel.drivers)
                  .sort((a, b) => a[1].name.localeCompare(b[1].name))
                  .map(([num, d]) => <option key={num} value={num}>{d.name} (#{num}, {d.team})</option>)}
              </select>
            </div>

            <hr className="my-5" style={{ borderColor: 'var(--panel-border)' }} />

            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Voluntary pit stops</label>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map(n => (
                  <button key={n} onClick={() => setStops(n)}
                    className="flex-1 py-2 text-sm font-semibold border"
                    style={{
                      borderColor: numStops === n ? 'var(--red)' : 'var(--panel-border)',
                      background: numStops === n ? 'var(--red)' : 'transparent',
                      color: numStops === n ? '#fff' : 'var(--text)',
                    }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {numStops > 0 && raceModel && (
              <div className="mb-5">
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Pit-stop laps</label>
                {pitLaps.map((lap, i) => (
                  <div key={i} className="flex items-center gap-2.5 mb-2">
                    <span className="text-sm w-32 shrink-0" style={{ color: 'var(--text-muted)' }}>Stop {i + 1} (end of lap)</span>
                    <input type="number" min="1" max={raceModel.total_laps - 1} value={lap}
                      className="!w-20"
                      onChange={e => {
                        const v = parseInt(e.target.value, 10) || lap;
                        setPitLaps(prev => prev.map((p, idx) => idx === i ? v : p));
                      }} />
                  </div>
                ))}
              </div>
            )}

            {raceModel && (
              <div className="mb-5">
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Tyre compounds, in order</label>
                {compounds.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 mb-2">
                    <span className="text-sm w-32 shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {i === 0 ? `Laps 1\u2013${pitLaps[0] || raceModel.total_laps}` : `Stint ${i + 1}`}
                    </span>
                    <select value={c} onChange={e => {
                      const v = e.target.value;
                      setCompounds(prev => prev.map((p, idx) => idx === i ? v : p));
                    }}>
                      {raceModel.compounds.map(opt => <option key={opt} value={opt}>{COMPOUND_LABELS[opt] || opt}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <button onClick={runSimulation} disabled={loading}
              className="w-full py-3 font-display font-bold text-lg disabled:opacity-50"
              style={{ background: 'var(--red)', color: '#fff' }}>
              Run this strategy
            </button>

            {isItalyAntonelli && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => loadPreset(ITALY_ANTONELLI_REAL)}
                  className="flex-1 py-2 text-xs border" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>
                  Load real team's strategy
                </button>
                <button onClick={() => loadPreset(ITALY_ANTONELLI_AGENT)}
                  className="flex-1 py-2 text-xs border" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>
                  Load agent's strategy
                </button>
              </div>
            )}
            {!isItalyAntonelli && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                Real-team and agent-strategy presets are only available for the Italian GP + Antonelli case study &mdash; for other races/drivers, build a strategy from scratch.
              </p>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 text-sm overflow-hidden"
                  style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', color: '#ffd8d0' }}>
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            {loading && <p className="text-sm mt-3.5" style={{ color: 'var(--text-muted)' }}>Pulling live data and fitting the model&hellip;</p>}
          </div>

          <div className="p-7">
            <div className="mb-6">
              <div className="text-sm mb-1.5" style={{ color: 'var(--text-muted)' }}>Predicted total race time</div>
              {result ? (
                <div className="font-display" style={{ fontSize: 'clamp(34px,5vw,52px)' }}>
                  <AnimatedNumber value={result.total_time_seconds} springOptions={{ bounce: 0, duration: 800 }} />
                  <span className="text-2xl align-top ml-1" style={{ color: 'var(--text-muted)' }}>s</span>
                  <div className="text-lg mt-1" style={{ color: 'var(--text-muted)' }}>{result.total_time_str}</div>
                </div>
              ) : <div className="font-display" style={{ fontSize: 'clamp(34px,5vw,52px)' }}>&mdash;</div>}

              {realResult && result && (
                <div className="flex gap-6 flex-wrap mt-3 text-sm">
                  <Delta label="vs. real team's strategy (model)" value={result.total_time_seconds - realResult.total_time_seconds} />
                  <Delta label="vs. actual recorded race time" value={result.total_time_seconds - 6675.281} />
                </div>
              )}
            </div>

            {result && <LapChart lapByLap={result.lap_by_lap} />}
          </div>
        </div>
      </section>

      {/* Static case-study content (comparison table, caveats, agent reasoning trail)
          is unchanged from the vanilla version -- omitted here for brevity, would be
          ported as plain JSX in the same structure. */}
    </div>
  );
}

function Delta({ label, value }) {
  const faster = value < 0;
  return (
    <div>
      {label}: <span className="font-bold" style={{ color: faster ? 'var(--green)' : 'var(--red)' }}>
        {faster ? '\u2212' : '+'}{Math.abs(value).toFixed(2)}s
      </span>
    </div>
  );
}

function LapChart({ lapByLap }) {
  const racingLaps = lapByLap.filter(l => !l.neutralized);
  if (racingLaps.length === 0) return null;
  const w = 960, h = 220, padL = 40, padB = 24, padT = 10;
  const chartW = w - padL - 10, chartH = h - padT - padB;
  const minT = Math.min(...racingLaps.map(l => l.seconds)) - 0.3;
  const maxT = Math.max(...racingLaps.map(l => l.seconds)) + 0.3;
  const barW = chartW / lapByLap.length;
  const compoundVar = (c) => c === 'SOFT' ? 'var(--soft)' : c === 'MEDIUM' ? 'var(--medium)' : 'var(--hard)';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto block">
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#2A2E35" />
      <line x1={padL} y1={padT + chartH} x2={w - 10} y2={padT + chartH} stroke="#2A2E35" />
      <text x={4} y={padT + 6} fill="#9BA1AC" fontSize="11">{maxT.toFixed(0)}s</text>
      <text x={4} y={padT + chartH} fill="#9BA1AC" fontSize="11">{minT.toFixed(0)}s</text>
      {lapByLap.map((l, i) => {
        const x = padL + i * barW;
        if (l.neutralized) {
          return <rect key={i} x={x + 1} y={padT} width={Math.max(barW - 2, 2)} height={chartH} fill="var(--yellow)" opacity={0.35}>
            <title>Lap {l.lap}: neutralized, fixed cost {l.seconds.toFixed(1)}s</title>
          </rect>;
        }
        const bh = ((l.seconds - minT) / (maxT - minT || 1)) * chartH;
        const y = padT + chartH - bh;
        return <motion.rect key={i} x={x + 1} y={y} width={Math.max(barW - 2, 1)}
          initial={{ height: 0 }} animate={{ height: Math.max(bh, 1) }} transition={{ duration: 0.3, delay: i * 0.005 }}
          fill={compoundVar(l.compound)} opacity={0.9}>
          <title>Lap {l.lap}: {l.seconds.toFixed(2)}s ({l.compound})</title>
        </motion.rect>;
      })}
    </svg>
  );
}
