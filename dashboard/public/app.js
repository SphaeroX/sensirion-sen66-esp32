const SETTINGS_KEY = 'aq_dashboard_settings';
const CURRENT_REFRESH_MS = 5000;
const HISTORY_REFRESH_MS = 60000;
const SERIES_COLORS = {
  co2: '#e74c3c',
  temperature: '#f39c12',
  humidity: '#3498db',
  dew_point: '#5dade2',
  pm1_0: '#1abc9c',
  pm2_5: '#9b59b6',
  pm4_0: '#2c3e50',
  pm10: '#8e44ad',
  voc: '#2ecc71',
  nox: '#16a085',
  nc0_5: '#d35400',
  nc1_0: '#c0392b',
  nc2_5: '#7f8c8d',
  nc4_0: '#95a5a6',
  nc10: '#34495e'
};

const dom = (() => {
  const displays = {
    co2: document.getElementById('co2'),
    temp: document.getElementById('temp'),
    hum: document.getElementById('hum'),
    dew: document.getElementById('dew'),
    iaq: document.getElementById('iaq'),
    pmx: document.getElementById('pmx'),
    pmxCat: document.getElementById('pmx-cat')
  };

  return {
    preset: document.getElementById('preset'),
    rangeInput: document.getElementById('range-input'),
    every: document.getElementById('every'),
    refresh: document.getElementById('refresh'),
    customRangeContainer: document.getElementById('custom-range'),
    fieldCheckboxes: Array.from(document.querySelectorAll('input.field')),
    displays
  };
})();

function getSelectedFields() {
  return dom.fieldCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
}

function saveSettings() {
  const settings = {
    preset: dom.preset.value,
    rangeInput: dom.rangeInput.value,
    every: dom.every.value,
    fields: getSelectedFields()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (stored) {
      if (stored.preset) dom.preset.value = stored.preset;
      if (stored.rangeInput) dom.rangeInput.value = stored.rangeInput;
      if (stored.every) dom.every.value = stored.every;
      if (Array.isArray(stored.fields)) {
        dom.fieldCheckboxes.forEach(cb => {
          cb.checked = stored.fields.includes(cb.value);
        });
      }
    }
  } catch (error) {
    console.error(error);
  }
  updateCustomVisibility();
}

function updateCustomVisibility() {
  const isCustom = dom.preset.value === 'custom';
  if (dom.customRangeContainer) {
    dom.customRangeContainer.classList.toggle('hidden', !isCustom);
  }
}

function buildSeries(rows, selected) {
  const byField = new Map();
  for (const field of selected) byField.set(field, []);
  for (const row of rows) {
    if (!byField.has(row._field)) continue;
    byField.get(row._field).push({ x: new Date(row._time).getTime(), y: row._value });
  }
  return selected.map(field => ({
    name: field,
    data: byField.get(field) || [],
    color: SERIES_COLORS[field]
  }));
}

function buildHistoryParams(range, every, fields) {
  const params = new URLSearchParams({ range });
  if (every) params.set('every', every);
  if (fields && fields.length) params.set('fields', fields.join(','));
  return params.toString();
}

function getHistorySelection() {
  const preset = dom.preset.value;
  const customRange = dom.rangeInput.value.trim();
  const range = preset === 'custom' ? (customRange || '-24h') : preset;
  const every = dom.every.value;
  const fields = getSelectedFields();
  return { range, every, fields };
}

function updateCurrentDisplay(current, iaq, pmx) {
  const data = current || {};
  dom.displays.co2.textContent = data.co2 ?? '-';
  dom.displays.temp.textContent = data.temperature ?? '-';
  dom.displays.hum.textContent = data.humidity ?? '-';
  dom.displays.dew.textContent = data.dew_point ?? '-';

  const iaqValue = iaq && typeof iaq.iaq === 'number' ? Math.round(iaq.iaq) : '-';
  dom.displays.iaq.textContent = iaqValue;

  const pmxValue = pmx && typeof pmx.pmx === 'number' ? pmx.pmx : '-';
  dom.displays.pmx.textContent = pmxValue;
  dom.displays.pmxCat.textContent = pmx && pmx.category ? pmx.category : '-';
}

async function fetchJson(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    console.warn(`Request to ${url} failed with status ${response.status}`);
    return null;
  }
  return response.json();
}

async function loadHistoryData(range, every, fields, signal) {
  const baseFields = fields.filter(field => field !== 'iaq');
  const historyUrl = baseFields.length ? `/api/history?${buildHistoryParams(range, every, baseFields)}` : null;
  const iaqUrl = fields.includes('iaq') ? `/api/iaq/history?${buildHistoryParams(range, every)}` : null;

  const historyPromise = historyUrl ? fetchJson(historyUrl, { signal }) : Promise.resolve([]);
  const iaqPromise = iaqUrl ? fetchJson(iaqUrl, { signal }) : Promise.resolve([]);

  const [rowsBase, rowsIaq] = await Promise.all([
    historyPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load base history data', error);
      return [];
    }),
    iaqPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load IAQ history data', error);
      return [];
    })
  ]);

  return [...(rowsBase || []), ...(rowsIaq || [])];
}

let currentRequestController;
let historyRequestController;

async function refreshCurrent() {
  if (currentRequestController) currentRequestController.abort();
  const controller = new AbortController();
  currentRequestController = controller;
  try {
    const [current, iaq, pmx] = await Promise.all([
      fetchJson('/api/current', { signal: controller.signal }),
      fetchJson('/api/iaq/current', { signal: controller.signal }),
      fetchJson('/api/pmx/current', { signal: controller.signal })
    ]);

    if (controller.signal.aborted) return;
    updateCurrentDisplay(current, iaq, pmx);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Failed to refresh current data', error);
    }
  }
}

async function refreshHistory() {
  if (historyRequestController) historyRequestController.abort();
  const controller = new AbortController();
  historyRequestController = controller;

  try {
    const { range, every, fields } = getHistorySelection();
    const rows = await loadHistoryData(range, every, fields, controller.signal);
    if (controller.signal.aborted) return;
    const series = buildSeries(rows, fields);
    chart.updateSeries(series);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Failed to refresh history', error);
    }
  }
}

function registerEventHandlers() {
  dom.preset.addEventListener('change', () => {
    updateCustomVisibility();
    saveSettings();
  });
  dom.every.addEventListener('change', saveSettings);
  dom.rangeInput.addEventListener('input', saveSettings);
  dom.refresh.addEventListener('click', () => {
    saveSettings();
    refreshCurrent();
    refreshHistory();
  });
  dom.fieldCheckboxes.forEach(cb => cb.addEventListener('change', () => {
    saveSettings();
    refreshHistory();
  }));
}

const chart = new ApexCharts(document.querySelector('#chart'), {
  chart: { type: 'line', height: '100%', animations: { enabled: true } },
  series: [],
  stroke: { width: 2, curve: 'smooth' },
  xaxis: { type: 'datetime' },
  yaxis: [
    { labels: { formatter: (value) => value.toFixed(0) } }
  ],
  legend: { position: 'top', horizontalAlign: 'left' },
  tooltip: { shared: true, x: { format: 'dd.MM HH:mm' } }
});

chart.render();

function initDashboard() {
  loadSettings();
  registerEventHandlers();
  refreshCurrent();
  refreshHistory();
  setInterval(refreshCurrent, CURRENT_REFRESH_MS);
  setInterval(refreshHistory, HISTORY_REFRESH_MS);
}

initDashboard();

