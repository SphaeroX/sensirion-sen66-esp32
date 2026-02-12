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
  pm_index: '#8e44ad',
  // External weather fields
  ext_temperature: '#ff9800',
  ext_humidity: '#03a9f4',
  ext_pressure: '#9c27b0',
  ext_wind_speed: '#795548',
  ext_wind_dir: '#607d8b',
  ext_cloud_cover: '#757575',
  ext_weather_code: '#8bc34a',
  ext_pm10: '#e91e63',
  ext_pm2_5: '#673ab7',
  ext_co: '#ff5722',
  ext_no2: '#009688',
  ext_so2: '#ffc107',
  ext_o3: '#00bcd4',
  ext_eu_aqi: '#f44336',
  ext_us_aqi: '#2196f3'
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
    pmIdx: document.getElementById('pmIdx'),
    // External weather displays
    extEuAqi: document.getElementById('extEuAqi'),
    extUsAqi: document.getElementById('extUsAqi'),
    extTemp: document.getElementById('extTemp'),
    extHum: document.getElementById('extHum'),
    extPressure: document.getElementById('extPressure'),
    extWindSpeed: document.getElementById('extWindSpeed'),
    extWindDir: document.getElementById('extWindDir'),
    extPm25: document.getElementById('extPm25'),
    extPm10: document.getElementById('extPm10')
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
    showEvents: document.getElementById('show-events'),
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
    fields: getSelectedFields(),
    showEvents: dom.showEvents ? dom.showEvents.checked : true
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
      if (dom.showEvents && typeof stored.showEvents === 'boolean') {
        dom.showEvents.checked = stored.showEvents;
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

function updateCurrentDisplay(current, iaq, pmx, idx, weather) {
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

  // External weather data
  const w = weather || {};
  if (dom.displays.extEuAqi) dom.displays.extEuAqi.textContent = w.eu_aqi ?? '-';
  if (dom.displays.extUsAqi) dom.displays.extUsAqi.textContent = w.us_aqi ?? '-';
  if (dom.displays.extTemp) dom.displays.extTemp.textContent = w.temperature ?? '-';
  if (dom.displays.extHum) dom.displays.extHum.textContent = w.humidity ?? '-';
  if (dom.displays.extPressure) dom.displays.extPressure.textContent = w.pressure ?? '-';
  if (dom.displays.extWindSpeed) dom.displays.extWindSpeed.textContent = w.wind_speed ?? '-';
  if (dom.displays.extWindDir) dom.displays.extWindDir.textContent = w.wind_direction ?? '-';
  if (dom.displays.extPm25) dom.displays.extPm25.textContent = w.pm2_5 ?? '-';
  if (dom.displays.extPm10) dom.displays.extPm10.textContent = w.pm10 ?? '-';
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
  const externalFields = ['ext_temperature','ext_humidity','ext_pressure','ext_wind_speed','ext_wind_dir',
                         'ext_cloud_cover','ext_weather_code','ext_pm10','ext_pm2_5','ext_co','ext_no2',
                         'ext_so2','ext_o3','ext_eu_aqi','ext_us_aqi'];
  
  // Mapping von ext_ Feldnamen zu den tatsächlichen InfluxDB Feldnamen
  const externalFieldMapping = {
    'ext_temperature': 'temperature',
    'ext_humidity': 'humidity',
    'ext_pressure': 'pressure',
    'ext_wind_speed': 'wind_speed',
    'ext_wind_dir': 'wind_direction',
    'ext_cloud_cover': 'cloud_cover',
    'ext_weather_code': 'weather_code',
    'ext_pm10': 'pm10',
    'ext_pm2_5': 'pm2_5',
    'ext_co': 'co',
    'ext_no2': 'no2',
    'ext_so2': 'so2',
    'ext_o3': 'o3',
    'ext_eu_aqi': 'eu_aqi',
    'ext_us_aqi': 'us_aqi'
  };
  
  const wantsIndex = fields.filter(f => indexFields.includes(f));
  const wantsIAQ = fields.includes('iaq');
  const wantsExternal = fields.filter(f => externalFields.includes(f));
  const baseFields = fields.filter(f => f !== 'iaq' && !indexFields.includes(f) && !externalFields.includes(f));

  const historyUrl = baseFields.length ? `/api/history?${buildHistoryParams(range, every, baseFields)}` : null;
  const iaqUrl = wantsIAQ ? `/api/iaq/history?${buildHistoryParams(range, every)}` : null;
  const idxUrl = wantsIndex.length ? `/api/index/history?${buildHistoryParams(range, every, wantsIndex)}` : null;
  
  // Konvertiere ext_ Feldnamen zu InfluxDB Feldnamen für die API-Anfrage
  const weatherFields = wantsExternal.map(f => externalFieldMapping[f]).filter(Boolean);
  const weatherUrl = weatherFields.length ? `/api/weather/history?${buildHistoryParams(range, every, weatherFields)}` : null;

  const historyPromise = historyUrl ? fetchJson(historyUrl, { signal }) : Promise.resolve([]);
  const iaqPromise = iaqUrl ? fetchJson(iaqUrl, { signal }) : Promise.resolve([]);
  const idxPromise = idxUrl ? fetchJson(idxUrl, { signal }) : Promise.resolve([]);
  const weatherPromise = weatherUrl ? fetchJson(weatherUrl, { signal }) : Promise.resolve([]);

  const [rowsBase, rowsIaq, rowsIdx, rowsWeatherRaw] = await Promise.all([
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
    }),
    weatherPromise.catch(error => {
      if (error.name === 'AbortError') throw error;
      console.error('Failed to load weather history data', error);
      return [];
    })
  ]);

  // Erstelle reverse mapping (InfluxDB name -> ext_ name)
  const reverseMapping = {};
  for (const [extName, influxName] of Object.entries(externalFieldMapping)) {
    reverseMapping[influxName] = extName;
  }
  
  // Mappe die zurückgegebenen Wetterdaten von InfluxDB-Namen zu ext_-Namen
  const rowsWeather = (rowsWeatherRaw || []).map(row => ({
    ...row,
    _field: reverseMapping[row._field] || row._field
  }));

  return [...(rowsBase || []), ...(rowsIaq || []), ...(rowsIdx || []), ...(rowsWeather || [])];
}

let currentRequestController;
let historyRequestController;

async function refreshCurrent() {
  if (currentRequestController) currentRequestController.abort();
  const controller = new AbortController();
  currentRequestController = controller;
  try {
    const [current, iaq, pmx, idx, weather] = await Promise.all([
      fetchJson('/api/current', { signal: controller.signal }),
      fetchJson('/api/iaq/current', { signal: controller.signal }),
      fetchJson('/api/pmx/current', { signal: controller.signal }),
      fetchJson('/api/index/current', { signal: controller.signal }),
      fetchJson('/api/weather/current', { signal: controller.signal })
    ]);

    if (controller.signal.aborted) return;
    updateCurrentDisplay(current, iaq, pmx, idx, weather);
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
    const showEvents = dom.showEvents ? dom.showEvents.checked : true;
    
    const [rows, events] = await Promise.all([
      loadHistoryData(range, every, fields, controller.signal),
      showEvents ? loadFanCleaningEvents(range, controller.signal) : Promise.resolve([])
    ]);
    if (controller.signal.aborted) return;
    const series = buildSeries(rows, fields);
    const annotations = showEvents ? buildAnnotations(events) : [];
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
  if (dom.showEvents) {
    dom.showEvents.addEventListener('change', () => {
      saveSettings();
      refreshHistory();
    });
  }
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

