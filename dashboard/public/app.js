const SETTINGS_KEY = 'aq_dashboard_settings';
const CURRENT_REFRESH_MS = 5000;
const HISTORY_REFRESH_MS = 60000;
const FAN_CLEANING_COLOR = '#ff9800';
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
  nc10: '#34495e',
  co2_index: '#ff6f61',
  voc_index: '#27ae60',
  pm_index: '#8e44ad'
};

// Use browser locale/timezone for date formatting
const BROWSER_LOCALE = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'de-DE';
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(BROWSER_LOCALE, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

const dom = (() => {
  const displays = {
    co2: document.getElementById('co2'),
    temp: document.getElementById('temp'),
    hum: document.getElementById('hum'),
    dew: document.getElementById('dew'),
    iaq: document.getElementById('iaq'),
    pmx: document.getElementById('pmx'),
    pmxCat: document.getElementById('pmx-cat'),
    vocIdx: document.getElementById('vocIdx'),
    co2Idx: document.getElementById('co2Idx'),
    pmIdx: document.getElementById('pmIdx')
  };

  return {
    preset: document.getElementById('preset'),
    rangeInput: document.getElementById('range-input'),
    every: document.getElementById('every'),
    refresh: document.getElementById('refresh'),
    customRangeContainer: document.getElementById('custom-range'),
    controlsToggle: document.getElementById('controls-toggle'),
    controlsContent: document.getElementById('controls-content'),
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
    let y = row._value;
    if (row._field === 'voc') {
      // Cap raw VOC index at 100 for better comparability
      if (typeof y === 'number' && isFinite(y)) y = Math.min(100, y);
    }
    byField.get(row._field).push({ x: new Date(row._time).getTime(), y });
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

function updateCurrentDisplay(current, iaq, pmx, idx) {
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

  // Indices 0..100 (100 = worst)
  const vi = idx && typeof idx.voc_index === 'number' ? Math.round(idx.voc_index) : '-';
  const ci = idx && typeof idx.co2_index === 'number' ? Math.round(idx.co2_index) : '-';
  const pi = idx && typeof idx.pm_index === 'number' ? Math.round(idx.pm_index) : '-';
  if (dom.displays.vocIdx) dom.displays.vocIdx.textContent = vi;
  if (dom.displays.co2Idx) dom.displays.co2Idx.textContent = ci;
  if (dom.displays.pmIdx) dom.displays.pmIdx.textContent = pi;
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
  const indexFields = ['voc_index','co2_index','pm_index'];
  const wantsIndex = fields.filter(f => indexFields.includes(f));
  const wantsIAQ = fields.includes('iaq');
  const baseFields = fields.filter(f => f !== 'iaq' && !indexFields.includes(f));

  const historyUrl = baseFields.length ? `/api/history?${buildHistoryParams(range, every, baseFields)}` : null;
  const iaqUrl = wantsIAQ ? `/api/iaq/history?${buildHistoryParams(range, every)}` : null;
  const idxUrl = wantsIndex.length ? `/api/index/history?${buildHistoryParams(range, every, wantsIndex)}` : null;

  const historyPromise = historyUrl ? fetchJson(historyUrl, { signal }) : Promise.resolve([]);
  const iaqPromise = iaqUrl ? fetchJson(iaqUrl, { signal }) : Promise.resolve([]);
  const idxPromise = idxUrl ? fetchJson(idxUrl, { signal }) : Promise.resolve([]);

  const [rowsBase, rowsIaq, rowsIdx] = await Promise.all([
    historyPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load base history data', error);
      return [];
    }),
    iaqPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load IAQ history data', error);
      return [];
    }),
    idxPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load index history data', error);
      return [];
    })
  ]);

  return [...(rowsBase || []), ...(rowsIaq || []), ...(rowsIdx || [])];
}

let currentRequestController;
let historyRequestController;

async function refreshCurrent() {
  if (currentRequestController) currentRequestController.abort();
  const controller = new AbortController();
  currentRequestController = controller;
  try {
    const [current, iaq, pmx, idx] = await Promise.all([
      fetchJson('/api/current', { signal: controller.signal }),
      fetchJson('/api/iaq/current', { signal: controller.signal }),
      fetchJson('/api/pmx/current', { signal: controller.signal }),
      fetchJson('/api/index/current', { signal: controller.signal })
    ]);

    if (controller.signal.aborted) return;
    updateCurrentDisplay(current, iaq, pmx, idx);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Failed to refresh current data', error);
    }
  }
}

async function loadFanCleaningEvents(range, signal) {
  try {
    const url = `/api/events/fan_cleaning?range=${encodeURIComponent(range)}`;
    const events = await fetchJson(url, { signal });
    return events || [];
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Failed to load fan cleaning events', error);
    }
    return [];
  }
}

function buildAnnotations(events) {
  return events.map((event, index) => ({
    x: new Date(event.time).getTime(),
    strokeDashArray: 0,
    borderColor: FAN_CLEANING_COLOR,
    borderWidth: 2,
    label: {
      borderColor: FAN_CLEANING_COLOR,
      style: {
        color: '#fff',
        background: FAN_CLEANING_COLOR,
        fontSize: '12px',
        fontWeight: 600
      },
      text: '🧹 Fan Cleaning',
      orientation: 'vertical',
      position: 'top',
      offsetX: 0,
      offsetY: 0
    }
  }));
}

async function refreshHistory() {
  if (historyRequestController) historyRequestController.abort();
  const controller = new AbortController();
  historyRequestController = controller;

  try {
    const { range, every, fields } = getHistorySelection();
    const [rows, events] = await Promise.all([
      loadHistoryData(range, every, fields, controller.signal),
      loadFanCleaningEvents(range, controller.signal)
    ]);
    if (controller.signal.aborted) return;
    const series = buildSeries(rows, fields);
    const annotations = buildAnnotations(events);
    chart.updateSeries(series);
    chart.updateOptions({
      annotations: {
        xaxis: annotations
      }
    });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Failed to refresh history', error);
    }
  }
}

function registerEventHandlers() {
  if (dom.controlsToggle && dom.controlsContent) {
    dom.controlsToggle.addEventListener('click', () => {
      dom.controlsContent.classList.toggle('hidden');
      const expanded = !dom.controlsContent.classList.contains('hidden');
      dom.controlsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      dom.controlsToggle.textContent = expanded ? 'Einstellungen ausblenden' : 'Einstellungen anzeigen';
    });
  }
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
  chart: { 
    type: 'line', 
    height: '100%', 
    animations: { enabled: true },
    events: {
      annotationMouseEnter: function(event, chartContext, config) {
        chartContext.toggleDataPointSelection(0, config.dataPointIndex);
      }
    }
  },
  series: [],
  stroke: { width: 2, curve: 'smooth' },
  xaxis: { type: 'datetime', labels: { datetimeUTC: false } },
  yaxis: [
    { labels: { formatter: (value) => value.toFixed(0) } }
  ],
  legend: { position: 'top', horizontalAlign: 'left' },
  tooltip: {
    shared: true,
    x: {
      formatter: (val) => DATE_TIME_FORMATTER.format(new Date(val))
    }
  },
  annotations: {
    xaxis: []
  }
});

chart.render();

function initDashboard() {
  loadSettings();
  registerEventHandlers();
  if (dom.controlsToggle && dom.controlsContent) {
    const expanded = !dom.controlsContent.classList.contains('hidden');
    dom.controlsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    dom.controlsToggle.textContent = expanded ? 'Einstellungen ausblenden' : 'Einstellungen anzeigen';
  }
  refreshCurrent();
  refreshHistory();
  setInterval(refreshCurrent, CURRENT_REFRESH_MS);
  setInterval(refreshHistory, HISTORY_REFRESH_MS);
}

initDashboard();

