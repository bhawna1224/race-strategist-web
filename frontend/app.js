/* =========================================================================
   Frontend logic -- calls the backend API (/api/races, /api/race/*,
   /api/simulate) instead of embedding pre-fetched race data. The backend
   does the real work (pulling OpenF1 data, fitting the model); this file
   just renders whatever it returns.
   ========================================================================= */

const API_BASE = ''; // same-origin: frontend and backend are one service

const COMPOUND_LABELS = { SOFT: 'Soft', MEDIUM: 'Medium', HARD: 'Hard' };
const DEFAULT_YEAR = 2026;

let currentYear = DEFAULT_YEAR;
let currentCountry = 'Italy';
let currentRaceModel = null;
let currentDriver = 12;
let numStops = 2;
let pitLaps = [3, 28];
let compounds = ['HARD', 'MEDIUM', 'MEDIUM'];

const ITALY_ANTONELLI_REAL = { pitLaps: [3, 28], compounds: ['HARD', 'MEDIUM', 'MEDIUM'] };
const ITALY_ANTONELLI_AGENT = { pitLaps: [3], compounds: ['SOFT', 'MEDIUM'] };

function setLoading(isLoading){
  document.getElementById('loadingBox').classList.toggle('show', isLoading);
  document.getElementById('runBtn').disabled = isLoading;
}

function showError(message){
  const box = document.getElementById('errorBox');
  box.textContent = message;
  box.classList.add('show');
}

function clearError(){
  document.getElementById('errorBox').classList.remove('show');
}

async function fetchRaceList(year){
  const res = await fetch(`${API_BASE}/api/races?year=${year}`);
  if (!res.ok) throw new Error(`Could not load race list (${res.status})`);
  return res.json();
}

async function fetchRaceModel(year, country){
  const res = await fetch(`${API_BASE}/api/race/${year}/${encodeURIComponent(country)}`);
  if (!res.ok){
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Could not load ${country} ${year} (${res.status})`);
  }
  return res.json();
}

async function postSimulate(year, country, driverNumber, pitLaps, compounds){
  const res = await fetch(`${API_BASE}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year, country, driver_number: driverNumber,
      pit_laps: pitLaps, compounds: compounds,
    }),
  });
  if (!res.ok){
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Simulation request failed (${res.status})`);
  }
  return res.json();
}

function formatSeconds(totalSeconds){
  let s = totalSeconds;
  const h = Math.floor(s / 3600); s -= h*3600;
  const m = Math.floor(s / 60); s -= m*60;
  if (h > 0) return `${h}h ${m}m ${s.toFixed(2)}s`;
  return `${m}m ${s.toFixed(2)}s`;
}

async function populateRacePicker(){
  const sel = document.getElementById('racePicker');
  try {
    const races = await fetchRaceList(currentYear);
    sel.innerHTML = races.map(r =>
      `<option value="${r.country}" ${r.country===currentCountry?'selected':''}>${r.circuit} (${r.country})</option>`
    ).join('');
  } catch (e) {
    // Live race list unavailable (e.g. no network to OpenF1 right now) --
    // fall back to just offering the one race we know works, rather than
    // leaving the picker broken.
    sel.innerHTML = `<option value="Italy" selected>Monza (Italy)</option>`;
    showError(`Couldn't load the full race list live (${e.message}). Defaulting to the Italian GP.`);
  }
  sel.addEventListener('change', async e => {
    currentCountry = e.target.value;
    numStops = 0;
    pitLaps = [];
    await loadRaceAndRender();
  });
}

function populateDriverPicker(){
  const sel = document.getElementById('driverPicker');
  const entries = Object.entries(currentRaceModel.drivers).sort((a,b) => a[1].name.localeCompare(b[1].name));
  sel.innerHTML = entries.map(([num, d]) =>
    `<option value="${num}" ${parseInt(num,10)===currentDriver?'selected':''}>${d.name} (#${num}, ${d.team})</option>`
  ).join('');
  if (!currentRaceModel.drivers[String(currentDriver)]){
    currentDriver = parseInt(entries[0][0], 10);
  }
  sel.onchange = async e => {
    currentDriver = parseInt(e.target.value, 10);
    updatePresetVisibility();
    await runSimulation();
  };
}

function updatePresetVisibility(){
  const isItalyAntonelli = (currentCountry === 'Italy' && currentDriver === 12);
  document.getElementById('presetRow').style.display = isItalyAntonelli ? 'flex' : 'none';
  document.getElementById('presetUnavailableNote').style.display = isItalyAntonelli ? 'none' : 'block';
}

function renderControls(){
  const race = currentRaceModel;
  const pitGroup = document.getElementById('pitLapsGroup');
  const pitInputsEl = document.getElementById('pitLapsInputs');
  const compEl = document.getElementById('compoundInputs');

  if (pitLaps.length !== numStops){
    const spacing = Math.floor(race.total_laps / (numStops+1));
    pitLaps = Array.from({length:numStops}, (_,i)=> pitLaps[i] || spacing*(i+1));
  }
  if (compounds.length !== numStops+1){
    compounds = Array.from({length:numStops+1}, (_,i)=> compounds[i] || race.compounds[0]);
  }

  pitGroup.style.display = numStops > 0 ? 'block' : 'none';
  pitInputsEl.innerHTML = '';
  pitLaps.forEach((lap, i) => {
    const row = document.createElement('div');
    row.className = 'pit-lap-row';
    row.innerHTML = `<span class="stint-label">Stop ${i+1} (end of lap)</span>
      <input type="number" min="1" max="${race.total_laps-1}" value="${lap}" data-pit-index="${i}">`;
    pitInputsEl.appendChild(row);
  });
  pitInputsEl.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.pitIndex, 10);
      pitLaps[idx] = parseInt(e.target.value, 10) || pitLaps[idx];
    });
  });

  compEl.innerHTML = '';
  compounds.forEach((c, i) => {
    const label = i === 0 ? `Laps 1\u2013${pitLaps[0] || race.total_laps}` : `Stint ${i+1}`;
    const row = document.createElement('div');
    row.className = 'stint-row';
    row.innerHTML = `<span class="stint-label">${label}</span>
      <select data-comp-index="${i}">
        ${race.compounds.map(opt => `<option value="${opt}" ${opt===c?'selected':''}>${COMPOUND_LABELS[opt]||opt}</option>`).join('')}
      </select>`;
    compEl.appendChild(row);
  });
  compEl.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.compIndex, 10);
      compounds[idx] = e.target.value;
    });
  });

  const legend = document.getElementById('chartLegend');
  legend.innerHTML = race.compounds.map(c =>
    `<span class="item"><span class="swatch" style="background:var(--${c.toLowerCase()});"></span>${COMPOUND_LABELS[c]||c}</span>`
  ).join('');

  const note = document.getElementById('fixedSegmentNote');
  if (race.neutralized_laps.length){
    note.textContent = `This race had a neutralization at lap${race.neutralized_laps.length>1?'s':''} ${race.neutralized_laps.join(', ')} (marked below), with a fixed real cost per lap of ${race.neutralized_laps.map(l=>race.fixed_lap_costs[String(l)].toFixed(1)+'s').join(', ')}.`;
  } else {
    note.textContent = 'This was a clean race \u2014 no neutralization events detected in the official race-control data.';
  }
}

document.getElementById('stopPicker').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#stopPicker button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  numStops = parseInt(btn.dataset.stops, 10);
  renderControls();
});

function compoundColor(c){
  const varName = c === 'SOFT' ? '--soft' : c === 'MEDIUM' ? '--medium' : '--hard';
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function renderChart(lapByLap){
  const svg = document.getElementById('lapChart');
  const racingLaps = lapByLap.filter(l => !l.neutralized);
  if (racingLaps.length === 0){ svg.innerHTML = ''; return; }

  const w = 960, h = 220, padL = 40, padB = 24, padT = 10;
  const chartW = w - padL - 10, chartH = h - padT - padB;
  const minT = Math.min(...racingLaps.map(l=>l.seconds)) - 0.3;
  const maxT = Math.max(...racingLaps.map(l=>l.seconds)) + 0.3;
  const totalLapSlots = lapByLap.length;
  const barW = chartW / totalLapSlots;

  let bars = '';
  let markers = '';
  lapByLap.forEach((l, i) => {
    const x = padL + i*barW;
    if (l.neutralized){
      markers += `<rect x="${x+1}" y="${padT}" width="${Math.max(barW-2,2)}" height="${chartH}" fill="var(--yellow)" opacity="0.35"><title>Lap ${l.lap}: neutralized, fixed cost ${l.seconds.toFixed(1)}s</title></rect>`;
      return;
    }
    const bh = ((l.seconds - minT) / (maxT - minT || 1)) * chartH;
    const y = padT + chartH - bh;
    bars += `<rect x="${x+1}" y="${y}" width="${Math.max(barW-2,1)}" height="${Math.max(bh,1)}" fill="${compoundColor(l.compound)}" opacity="0.9"><title>Lap ${l.lap}: ${l.seconds.toFixed(2)}s (${l.compound})</title></rect>`;
  });

  const axisLabels = `
    <text x="4" y="${padT+6}" fill="#9BA1AC" font-size="11" font-family="Inter">${maxT.toFixed(0)}s</text>
    <text x="4" y="${padT+chartH}" fill="#9BA1AC" font-size="11" font-family="Inter">${minT.toFixed(0)}s</text>
  `;

  svg.innerHTML = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+chartH}" stroke="#2A2E35"/>
    <line x1="${padL}" y1="${padT+chartH}" x2="${w-10}" y2="${padT+chartH}" stroke="#2A2E35"/>
    ${axisLabels}${markers}${bars}`;
}

async function renderResult(result){
  const resultTotal = document.getElementById('resultTotal');
  const deltaRow = document.getElementById('deltaRow');

  if (result.error){
    showError(result.error);
    resultTotal.textContent = '\u2014';
    deltaRow.innerHTML = '';
    document.getElementById('lapChart').innerHTML = '';
    return;
  }
  clearError();
  resultTotal.textContent = result.total_time_str;
  deltaRow.innerHTML = '';

  if (currentCountry === 'Italy' && currentDriver === 12){
    try {
      const realResult = await postSimulate(currentYear, 'Italy', 12, ITALY_ANTONELLI_REAL.pitLaps, ITALY_ANTONELLI_REAL.compounds);
      const vsReal = result.total_time_seconds - realResult.total_time_seconds;
      const vsActual = result.total_time_seconds - 6675.281;
      deltaRow.innerHTML = `
        <div class="delta">vs. real team's strategy (model): <span class="num ${vsReal<0?'faster':'slower'}">${vsReal<0?'\u2212':'+'}${Math.abs(vsReal).toFixed(2)}s</span></div>
        <div class="delta">vs. actual recorded race time: <span class="num ${vsActual<0?'faster':'slower'}">${vsActual<0?'\u2212':'+'}${Math.abs(vsActual).toFixed(2)}s</span></div>
      `;
    } catch (e) { /* comparison is a nice-to-have; don't block the main result on it */ }
  }
  renderChart(result.lap_by_lap);
}

async function runSimulation(){
  clearError();
  setLoading(true);
  try {
    const result = await postSimulate(currentYear, currentCountry, currentDriver, [...pitLaps], [...compounds]);
    await renderResult(result);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

async function loadRaceAndRender(){
  clearError();
  setLoading(true);
  try {
    currentRaceModel = await fetchRaceModel(currentYear, currentCountry);
    populateDriverPicker();
    updatePresetVisibility();
    renderControls();
    await runSimulation();
  } catch (e) {
    showError(`Couldn't load ${currentCountry}: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

document.getElementById('runBtn').addEventListener('click', runSimulation);

document.getElementById('presetReal').addEventListener('click', async () => {
  numStops = ITALY_ANTONELLI_REAL.pitLaps.length;
  pitLaps = [...ITALY_ANTONELLI_REAL.pitLaps];
  compounds = [...ITALY_ANTONELLI_REAL.compounds];
  document.querySelectorAll('#stopPicker button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.stops,10)===numStops));
  renderControls();
  await runSimulation();
});

document.getElementById('presetAgent').addEventListener('click', async () => {
  numStops = ITALY_ANTONELLI_AGENT.pitLaps.length;
  pitLaps = [...ITALY_ANTONELLI_AGENT.pitLaps];
  compounds = [...ITALY_ANTONELLI_AGENT.compounds];
  document.querySelectorAll('#stopPicker button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.stops,10)===numStops));
  renderControls();
  await runSimulation();
});

/* Initial load: Italy, matching the hero numbers above. */
(async function init(){
  await populateRacePicker();
  await loadRaceAndRender();
})();
