import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TextEffect } from './components/motion-primitives/text-effect';
import { AnimatedNumber } from './components/motion-primitives/animated-number';
import { BorderTrail } from './components/motion-primitives/border-trail';
import { GlowEffect } from './components/motion-primitives/glow-effect';
import { Spotlight } from './components/motion-primitives/spotlight';
import {
  Disclosure,
  DisclosureTrigger,
  DisclosureContent,
} from './components/motion-primitives/disclosure';

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

  useEffect(() => {
    api(`/api/races?year=${DEFAULT_YEAR}`)
      .then(setRaces)
      .catch(() => setRaces([{ country: 'Italy', circuit: 'Monza' }]));
  }, []);

  const isFirstLoad = useRef(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api(`/api/race/${DEFAULT_YEAR}/${encodeURIComponent(country)}`)
      .then(model => {
        setRaceModel(model);
        const driverKeys = Object.keys(model.drivers);
        if (!model.drivers[String(driver)]) setDriver(parseInt(driverKeys[0], 10));
        // Reset the strategy inputs to sensible defaults for THIS race,
        // rather than carrying over stale values from whichever race was
        // selected before -- but skip this on the very first load, so
        // the page still opens showing the real Antonelli strategy that
        // matches the hero numbers above, instead of resetting away from
        // it immediately.
        if (!isFirstLoad.current) {
          setNumStops(0);
          setPitLaps([]);
          setCompounds([model.compounds[0]]);
        }
        isFirstLoad.current = false;
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
        body: JSON.stringify({ year: DEFAULT_YEAR, country, driver_number: driver, pit_laps: pitLaps, compounds }),
      });
      if (r.error) { setError(r.error); setResult(null); return; }
      setResult(r);
      const driverInfo = raceModel.drivers[String(driver)];
      if (driverInfo?.actual_strategy) {
        const rr = await api('/api/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: DEFAULT_YEAR, country, driver_number: driver, pit_laps: driverInfo.actual_strategy.pit_laps, compounds: driverInfo.actual_strategy.compounds }),
        });
        setRealResult(rr.error ? null : rr);
      } else {
        setRealResult(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [raceModel, country, driver, pitLaps, compounds]);

  useEffect(() => { if (raceModel) runSimulation(); /* eslint-disable-next-line */ }, [raceModel, driver]);
  useEffect(() => { if (raceModel) runSimulation(); /* eslint-disable-next-line */ }, [pitLaps, compounds]);

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

  const isItalyAntonelli = country === 'Italy' && driver === 12;

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.15]"
        style={{ background: 'radial-gradient(ellipse 800px 500px at 20% 0%, var(--red), transparent), radial-gradient(ellipse 600px 400px at 90% 20%, var(--purple), transparent)' }} />

      <div className="relative z-10 border-b" style={{ borderColor: 'var(--panel-border)' }}>
        <div className="max-w-5xl mx-auto px-6 py-3.5 flex justify-between items-baseline flex-wrap gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>2026 Italian Grand Prix &middot; Monza &middot; 53 laps</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--green)' }}>Model validated &mdash; &minus;2.91% vs. actual</span>
        </div>
      </div>

      <header className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-10">
        <p className="text-lg mb-4" style={{ color: 'var(--text-muted)' }}>Car #12 &middot; Kimi Antonelli &middot; Mercedes</p>
        <TextEffect as="h1" per="word" preset="fade-in-blur" className="font-display max-w-3xl" style={{ fontSize: 'clamp(40px,6vw,68px)' }}>
          He started P19. A red flag reshuffled the whole race. He won it on a tyre gamble.
        </TextEffect>
        <p className="text-lg mt-5 max-w-xl" style={{ color: 'var(--text-muted)' }}>
          An autonomous strategist that proposes pit-stop strategies, tests each one against a model fit from real race data, and refines its guess. Pick any race below &mdash; the backend pulls and fits the model live.
        </p>

        <div className="mt-11 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HeroCard label="Real team's strategy · model's prediction" seconds={6481.22} color="var(--text)" delay={0.2} />
          <HeroCard label="Best strategy the agent found" seconds={6451.52} color="var(--green)" delay={0.5} />
        </div>
      </header>

      <section className="relative z-10 border-t max-w-5xl mx-auto px-6 py-14" style={{ borderColor: 'var(--panel-border)' }}>
        <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Try it yourself &mdash; live backend</p>
        <h2 className="font-display mb-4" style={{ fontSize: 'clamp(28px,4vw,38px)' }}>Build a pit-stop strategy for any 2026 race</h2>

        <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] border mt-8" style={{ borderColor: 'var(--panel-border)' }}>
          <Spotlight className="from-red-500/20 via-red-500/10 to-transparent" size={280} />
          <div className="relative p-7 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Race</label>
              <select value={country} onChange={e => setCountry(e.target.value)}>
                {races.map(r => <option key={r.country} value={r.country}>{r.circuit} ({r.country})</option>)}
              </select>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Driver</label>
              <select value={driver} onChange={e => setDriver(parseInt(e.target.value, 10))} disabled={!raceModel}>
                {raceModel && Object.entries(raceModel.drivers).sort((a, b) => a[1].name.localeCompare(b[1].name))
                  .map(([num, d]) => <option key={num} value={num}>{d.name} (#{num}, {d.team})</option>)}
              </select>
            </div>

            <hr className="my-5" style={{ borderColor: 'var(--panel-border)' }} />

            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Voluntary pit stops</label>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map(n => (
                  <button key={n} onClick={() => setStops(n)} className="flex-1 py-2 text-sm font-semibold border transition-colors"
                    style={{ borderColor: numStops === n ? 'var(--red)' : 'var(--panel-border)', background: numStops === n ? 'var(--red)' : 'transparent', color: numStops === n ? '#fff' : 'var(--text)' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence>
              {numStops > 0 && raceModel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
                  <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Pit-stop laps</label>
                  {pitLaps.map((lap, i) => (
                    <div key={i} className="flex items-center gap-2.5 mb-2">
                      <span className="text-sm w-32 shrink-0" style={{ color: 'var(--text-muted)' }}>Stop {i + 1} (end of lap)</span>
                      <input type="number" min="1" max={raceModel.total_laps - 1} value={lap} className="!w-20"
                        onChange={e => { const v = parseInt(e.target.value, 10) || lap; setPitLaps(prev => prev.map((p, idx) => idx === i ? v : p)); }} />
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {raceModel && (
              <div className="mb-5">
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Tyre compounds, in order</label>
                {compounds.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 mb-2">
                    <span className="text-sm w-32 shrink-0" style={{ color: 'var(--text-muted)' }}>{i === 0 ? `Laps 1\u2013${pitLaps[0] || raceModel.total_laps}` : `Stint ${i + 1}`}</span>
                    <select value={c} onChange={e => { const v = e.target.value; setCompounds(prev => prev.map((p, idx) => idx === i ? v : p)); }}>
                      {raceModel.compounds.map(opt => <option key={opt} value={opt}>{COMPOUND_LABELS[opt] || opt}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <GlowEffect colors={['#E8402C', '#A64DFF']} mode="pulse" blur="soft" className="opacity-60" />
              <button onClick={runSimulation} disabled={loading} className="relative w-full py-3 font-display font-bold text-lg disabled:opacity-50" style={{ background: 'var(--red)', color: '#fff' }}>
                Run this strategy
              </button>
            </div>

            {isItalyAntonelli && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => loadPreset(ITALY_ANTONELLI_REAL)} className="flex-1 py-2 text-xs border" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>Load real team's strategy</button>
                <button onClick={() => loadPreset(ITALY_ANTONELLI_AGENT)} className="flex-1 py-2 text-xs border" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>Load agent's strategy</button>
              </div>
            )}
            {!isItalyAntonelli && (
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Real-team and agent-strategy presets are only available for the Italian GP + Antonelli case study &mdash; for other races/drivers, build a strategy from scratch.</p>
            )}

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 text-sm overflow-hidden" style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', color: '#ffd8d0' }}>
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
            {loading && <p className="text-sm mt-3.5" style={{ color: 'var(--text-muted)' }}>Pulling live data and fitting the model&hellip;</p>}
          </div>

          <div className="relative p-7">
            {result && <BorderTrail className="bg-gradient-to-l from-red-500 via-purple-500 to-transparent" size={140} />}
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
                  <Delta label="vs. this driver's real strategy (model)" value={result.total_time_seconds - realResult.total_time_seconds} />
                  {raceModel.drivers[String(driver)]?.actual_time_seconds != null && (
                    <Delta label="vs. their actual recorded race time" value={result.total_time_seconds - raceModel.drivers[String(driver)].actual_time_seconds} />
                  )}
                </div>
              )}
            </div>
            {result && <LapChart lapByLap={result.lap_by_lap} />}
          </div>
        </div>
      </section>

      {realResult && result && (
        <section className="relative z-10 border-t max-w-5xl mx-auto px-6 py-14" style={{ borderColor: 'var(--panel-border)' }}>
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Final comparison &mdash; {raceModel.drivers[String(driver)]?.name}, {country}</p>
          <h2 className="font-display mb-4" style={{ fontSize: 'clamp(28px,4vw,38px)' }}>Your strategy vs. what they actually did</h2>
          <table className="w-full mt-6 text-[15px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr><th></th><th className="text-left text-sm font-semibold pb-3" style={{ color: 'var(--text-muted)' }}>Your strategy</th><th className="text-left text-sm font-semibold pb-3" style={{ color: 'var(--text-muted)' }}>Their real strategy</th></tr>
            </thead>
            <tbody>
              <Row label="Compounds" a={compounds.join(' → ')} b={raceModel.drivers[String(driver)].actual_strategy.compounds.join(' → ')} />
              <Row label="Voluntary stops" a={pitLaps.length ? pitLaps.join(', ') : 'none'} b={raceModel.drivers[String(driver)].actual_strategy.pit_laps.length ? raceModel.drivers[String(driver)].actual_strategy.pit_laps.join(', ') : 'none'} />
              <Row label="Model's predicted time" a={<strong className="font-display text-lg">{result.total_time_str}</strong>} b={<strong className="font-display text-lg">{realResult.total_time_str}</strong>} />
              <Row label="Actual recorded race time" a="Only meaningful if this is their real strategy" b={raceModel.drivers[String(driver)].actual_time_seconds != null ? <strong className="font-display text-lg">{formatSeconds(raceModel.drivers[String(driver)].actual_time_seconds)}</strong> : 'Not recorded (DNF or no data)'} last />
            </tbody>
          </table>
          <p className="text-lg mt-6 max-w-xl" style={{ color: 'var(--text-muted)' }}>
            "Their real strategy" is reconstructed from this driver's actual historical stints in this race &mdash; not invented. The model's prediction for it is directly comparable to your strategy's prediction, since both come from the same fitted model.
          </p>
        </section>
      )}
      {!realResult && (
        <section className="relative z-10 border-t max-w-5xl mx-auto px-6 py-10" style={{ borderColor: 'var(--panel-border)' }}>
          <p className="text-lg max-w-xl" style={{ color: 'var(--text-muted)' }}>
            No real-strategy comparison available for this driver &mdash; either their real stint data couldn't be reconstructed, or a simulation hasn't completed yet.
          </p>
        </section>
      )}

      <section className="relative z-10 border-t max-w-5xl mx-auto px-6 py-14" style={{ borderColor: 'var(--panel-border)' }}>
        <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>What the model can and can't tell you</p>
        <h2 className="font-display mb-6" style={{ fontSize: 'clamp(28px,4vw,38px)' }}>The honest limits of this analysis</h2>
        <div className="flex flex-col gap-2">
          <Caveat title="Hard and Medium tyres show zero fitted degradation (in this race)">
            Monza is a genuinely low-degradation circuit. Once fuel-burn effects are accounted for, real tyre wear on these two compounds was indistinguishable from noise in this race's data — confirmed by two separate experiments, not assumed. Other tracks show real, nonzero degradation (try Monaco or Silverstone above).
          </Caveat>
          <Caveat title="Neutralization events are treated as fixed, not strategic">
            Every strategy for a given race experiences the same red flags/safety cars at the same laps, with the same fixed cost. That's a fact of the specific historical race being modeled, not a choice being simulated.
          </Caveat>
          <Caveat title="No model of track position, traffic, or Virtual Safety Car timing">
            The real team's lap-28 stop happened inside a live VSC window, when the cost of pitting is temporarily much lower than a flat pit-loss constant assumes. The model can't see that — so its verdict against that stop is really a verdict against pitting under normal conditions, not a fair read of the real tactical decision.
          </Caveat>
          <Caveat title="This isn't a claim of finding the optimal strategy">
            A grid search over the small space of valid strategies would find this model's numeric optimum far faster than an agent reasoning turn by turn. The point of this project is a legible, reasoned trail — not raw optimization power.
          </Caveat>
        </div>
      </section>

      {isItalyAntonelli && (
        <section className="relative z-10 border-t max-w-5xl mx-auto px-6 py-14" style={{ borderColor: 'var(--panel-border)' }}>
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Real, verified case study &mdash; not a live demo</p>
          <h2 className="font-display mb-4" style={{ fontSize: 'clamp(28px,4vw,38px)' }}>The agent's actual reasoning trail</h2>
          <p className="text-lg max-w-xl" style={{ color: 'var(--text-muted)' }}>An LLM agent, connected to the underlying tools over MCP, made these five attempts for the Italian GP. Every number below matches what the tool actually returned. This trail is fixed &mdash; it doesn't change when you try other strategies above.</p>
          <div className="mt-5">
            <Attempt n={1} strategy="Hard → Medium → Medium, stop @ 28" result="1h 48m 01.22s — baseline" tone="baseline"
              reasoning="Baseline: replicate the real team's actual strategy to validate the model against reality." />
            <Attempt n={2} strategy="Hard → Medium, no stop" result="1h 47m 34.92s — −26.30s" tone="faster"
              reasoning="Since Medium has zero degradation in this model, refreshing tyres at lap 28 gains no pace but costs a full pit stop. Testing whether skipping it entirely beats the real strategy." />
            <Attempt n={3} strategy="Soft → Medium, no stop" result="1h 47m 31.52s — −29.69s" tone="faster"
              reasoning="Checking Soft's base pace advantage for the short pre-red-flag stint, which gets wiped by the red flag reset anyway." />
            <Attempt n={4} strategy="Hard → Soft → Soft, stop @ 28" result="1h 48m 17.85s — worse, +16.63s" tone="slower"
              reasoning="Testing whether splitting the post-restart laps into two Soft stints beats the flat-pace Medium baseline — does Soft's pace edge outweigh its wear plus an extra pit stop?" />
            <Attempt n={5} strategy="Medium → Medium, no stop" result="1h 47m 32.99s" tone=""
              reasoning="Sanity-checking the opening-compound choice: confirming Soft-open genuinely beats Medium-open and attempt 3 wasn't a fluke." last />
          </div>
        </section>
      )}

      <footer className="relative z-10 border-t max-w-5xl mx-auto px-6 py-8 text-sm" style={{ borderColor: 'var(--panel-border)', color: 'var(--text-muted)' }}>
        Built on real telemetry from the OpenF1 API, pulled and fit live by the backend on request.
      </footer>
    </div>
  );
}

function HeroCard({ label, seconds, color, delay }) {
  return (
    <div className="relative border p-6" style={{ borderColor: 'var(--panel-border)' }}>
      <BorderTrail size={100} className="bg-gradient-to-l from-red-500 via-purple-500 to-transparent" transition={{ delay, duration: 4, repeat: Infinity, ease: 'linear' }} />
      <div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-display" style={{ fontSize: 'clamp(28px,4vw,40px)', color }}>
        <AnimatedNumber value={seconds} springOptions={{ bounce: 0.15, duration: 1600 }} />
        <span className="text-lg ml-1" style={{ color: 'var(--text-muted)' }}>s</span>
      </div>
      <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{formatSeconds(seconds)}</div>
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

function Row({ label, a, b, last }) {
  const style = last ? {} : { borderBottom: '1px solid var(--panel-border)' };
  return (
    <tr style={style}>
      <td className="py-3 text-sm whitespace-nowrap pr-4" style={{ color: 'var(--text-muted)' }}>{label}</td>
      <td className="py-3 pr-4">{a}</td>
      <td className="py-3">{b}</td>
    </tr>
  );
}

function Caveat({ title, children }) {
  return (
    <Disclosure className="border-l-2 pl-4 py-1" style={{ borderColor: 'var(--yellow)' }}>
      <DisclosureTrigger>
        <button className="text-left w-full font-semibold text-[17px] py-1">{title}</button>
      </DisclosureTrigger>
      <DisclosureContent>
        <p className="text-[15px] max-w-xl pb-2" style={{ color: 'var(--text-muted)' }}>{children}</p>
      </DisclosureContent>
    </Disclosure>
  );
}

function Attempt({ n, strategy, result, reasoning, tone, last }) {
  const color = tone === 'faster' ? 'var(--green)' : tone === 'slower' ? 'var(--red)' : 'var(--text-muted)';
  return (
    <motion.div initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: n * 0.05 }}
      className="py-5" style={last ? {} : { borderBottom: '1px solid var(--panel-border)' }}>
      <div className="flex justify-between items-baseline gap-4 flex-wrap mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Attempt {n}</span>
        <span className="font-display font-bold text-lg">{strategy}</span>
        <span className="text-sm font-semibold" style={{ color }}>{result}</span>
      </div>
      <p className="text-[15px] italic max-w-xl" style={{ color: 'var(--text-muted)' }}>&ldquo;{reasoning}&rdquo;</p>
    </motion.div>
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
          return <rect key={i} x={x + 1} y={padT} width={Math.max(barW - 2, 2)} height={chartH} fill="var(--yellow)" opacity={0.35}><title>Lap {l.lap}: neutralized, fixed cost {l.seconds.toFixed(1)}s</title></rect>;
        }
        const bh = ((l.seconds - minT) / (maxT - minT || 1)) * chartH;
        const y = padT + chartH - bh;
        return <motion.rect key={i} x={x + 1} y={y} width={Math.max(barW - 2, 1)} initial={{ height: 0 }} animate={{ height: Math.max(bh, 1) }} transition={{ duration: 0.3, delay: i * 0.005 }} fill={compoundVar(l.compound)} opacity={0.9}><title>Lap {l.lap}: {l.seconds.toFixed(2)}s ({l.compound})</title></motion.rect>;
      })}
    </svg>
  );
}
