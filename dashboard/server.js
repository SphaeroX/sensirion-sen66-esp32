const express = require('express');
const path = require('path');
const { InfluxDB } = require('@influxdata/influxdb-client');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const port = process.env.PORT || 3000;

const client = new InfluxDB({ url: process.env.INFLUXDB_URL, token: process.env.INFLUXDB_TOKEN });
const queryApi = client.getQueryApi(process.env.INFLUXDB_ORG);
const bucket = process.env.INFLUXDB_BUCKET;

app.use(express.static(path.join(__dirname, 'public')));

// ===== IAQ computation helpers (0..100, higher is worse) =====
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lin(x, x0, x1, y0, y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
}

// WHO 2021 aligned bands for PM2.5 (µg/m³)
function scorePM25(v) {
  if (!isFinite(v)) return null;
  if (v <= 10) return lin(v, 0, 10, 0, 20);
  if (v <= 25) return lin(v, 10, 25, 20, 50);
  if (v <= 50) return lin(v, 25, 50, 50, 75);
  if (v <= 75) return lin(v, 50, 75, 75, 90);
  return 100;
}

// WHO 2021 aligned bands for PM10 (µg/m³)
function scorePM10(v) {
  if (!isFinite(v)) return null;
  if (v <= 20) return lin(v, 0, 20, 0, 20);
  if (v <= 45) return lin(v, 20, 45, 20, 60);
  if (v <= 100) return lin(v, 45, 100, 60, 90);
  return 100;
}

// Indoor CO2 comfort (ppm)
function scoreCO2(v) {
  if (!isFinite(v)) return null;
  if (v <= 800) return lin(v, 400, 800, 0, 20);
  if (v <= 1000) return lin(v, 800, 1000, 20, 40);
  if (v <= 1400) return lin(v, 1000, 1400, 40, 70);
  if (v <= 2000) return lin(v, 1400, 2000, 70, 90);
  return 100;
}

// Sensirion VOC Index (typical: ~100 good; 100-200 moderate; >200 poor)
function scoreVOCIndex(v) {
  if (!isFinite(v)) return null;
  if (v <= 100) return 10; // a small baseline penalty
  if (v <= 200) return lin(v, 100, 200, 10, 60);
  if (v <= 300) return lin(v, 200, 300, 60, 85);
  if (v <= 500) return lin(v, 300, 500, 85, 100);
  return 100;
}

// Sensirion NOx Index (similar scale)
function scoreNOxIndex(v) {
  if (!isFinite(v)) return null;
  if (v <= 100) return 10;
  if (v <= 200) return lin(v, 100, 200, 10, 60);
  if (v <= 300) return lin(v, 200, 300, 60, 85);
  if (v <= 500) return lin(v, 300, 500, 85, 100);
  return 100;
}

function computeIAQ(fields) {
  const scores = [];
  if (fields.pm2_5 != null) { const s = scorePM25(fields.pm2_5); if (s != null) scores.push(s); }
  if (fields.pm10 != null)  { const s = scorePM10(fields.pm10);   if (s != null) scores.push(s); }
  if (fields.co2 != null)   { const s = scoreCO2(fields.co2);     if (s != null) scores.push(s); }
  if (fields.voc != null)   { const s = scoreVOCIndex(fields.voc); if (s != null) scores.push(s); }
  if (fields.nox != null)   { const s = scoreNOxIndex(fields.nox); if (s != null) scores.push(s); }
  if (!scores.length) return null;
  // Conservative aggregation: dominated by the worst pollutant
  return clamp(Math.max(...scores), 0, 100);
}

// Convenience wrappers to compute capped indices (0..100)
function computeCO2Index(v) {
  const s = scoreCO2(v);
  return s == null ? null : clamp(s, 0, 100);
}

function computeVOCIndex(v) {
  const s = scoreVOCIndex(v);
  return s == null ? null : clamp(s, 0, 100);
}

function computePMIndex(fields) {
  const s25 = fields.pm2_5 != null ? scorePM25(fields.pm2_5) : null;
  const s10 = fields.pm10 != null ? scorePM10(fields.pm10) : null;
  const parts = [s25, s10].filter(v => v != null);
  if (!parts.length) return null;
  return clamp(Math.max(...parts), 0, 100);
}

// ===== PMX indicator (0..500) =====
const pm25Breakpoints = [
  { cLow: 0.0,   cHigh: 9.0,   iLow:   0, iHigh:  50 },
  { cLow: 9.1,   cHigh: 35.0,  iLow:  51, iHigh: 100 },
  { cLow: 35.1,  cHigh: 55.0,  iLow: 101, iHigh: 150 },
  { cLow: 55.1,  cHigh: 125.0, iLow: 151, iHigh: 200 },
  { cLow: 125.1, cHigh: 225.0, iLow: 201, iHigh: 300 },
  { cLow: 225.1, cHigh: 325.0, iLow: 301, iHigh: 400 },
  { cLow: 325.1, cHigh: 500.0, iLow: 401, iHigh: 500 }
];

const pm10Breakpoints = [
  { cLow: 0,   cHigh: 54,  iLow:   0, iHigh:  50 },
  { cLow: 55,  cHigh: 154, iLow:  51, iHigh: 100 },
  { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
  { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
  { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
  { cLow: 425, cHigh: 504, iLow: 301, iHigh: 400 },
  { cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 }
];

function interpolateBreakpoints(bp25, bp10, diameter) {
  const ratio = (diameter - 2.5) / (10 - 2.5);
  return bp25.map((a, i) => {
    const b = bp10[i] || bp10[bp10.length - 1];
    return {
      cLow: a.cLow + ratio * (b.cLow - a.cLow),
      cHigh: a.cHigh + ratio * (b.cHigh - a.cHigh),
      iLow: a.iLow,
      iHigh: a.iHigh
    };
  });
}

const pm4Breakpoints = interpolateBreakpoints(pm25Breakpoints, pm10Breakpoints, 4);

function nowCast(values) {
  const clean = values.filter(v => isFinite(v) && v >= 0);
  if (!clean.length) return null;
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const w = Math.min(1, Math.max(0.5, max === 0 ? 1 : min / max));
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < clean.length && i < 12; i++) {
    const weight = Math.pow(w, i);
    sum += clean[i] * weight;
    wsum += weight;
  }
  return sum / wsum;
}

function aqiFromBreakpoints(conc, table) {
  if (conc == null || !isFinite(conc)) return null;
  const c = Math.max(0, conc);
  for (const bp of table) {
    if (c <= bp.cHigh) {
      return bp.iLow + (bp.iHigh - bp.iLow) * ((c - bp.cLow) / (bp.cHigh - bp.cLow));
    }
  }
  return 500;
}

function categoryFromAQI(i) {
  if (i <= 50) return 'good';
  if (i <= 100) return 'moderate';
  if (i <= 150) return 'unhealthy for sensitive groups';
  if (i <= 200) return 'unhealthy';
  if (i <= 300) return 'very unhealthy';
  return 'hazardous';
}

function computePMX(series) {
  const conc = {};
  const subs = {};
  const parts = [];
  function add(field, table, weight) {
    const c = nowCast(series[field] || []);
    conc[field] = c;
    if (c == null) return;
    const a = aqiFromBreakpoints(c, table);
    subs[field] = Math.round(a);
    parts.push({ field, aqi: a, weight });
  }

  add('pm1_0', pm25Breakpoints, 0.40);
  add('pm2_5', pm25Breakpoints, 0.35);
  add('pm4_0', pm4Breakpoints, 0.15);
  add('pm10', pm10Breakpoints, 0.10);

  if (!parts.length) {
    return { pmx: null, category: null, dominant: null, subs, concNowCast: conc, explain: { weights: {}, breakpoints: {} } };
  }

  const dominant = parts.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const mean = parts.reduce((s, p) => s + p.aqi * p.weight, 0) / weightSum;
  const pmx = Math.round(0.7 * dominant.aqi + 0.3 * mean);

  return {
    pmx,
    category: categoryFromAQI(pmx),
    dominant: dominant.field,
    subs,
    concNowCast: conc,
    explain: {
      weights: { pm1_0: 0.40, pm2_5: 0.35, pm4_0: 0.15, pm10: 0.10 },
      breakpoints: { pm25: pm25Breakpoints, pm10: pm10Breakpoints, pm4: pm4Breakpoints }
    }
  };
}

app.get('/api/current', async (req, res) => {
  try {
    const query = `from(bucket:"${bucket}") |> range(start:-5m) |> filter(fn:(r)=>r._measurement=="environment") |> last()`;
    const rows = await queryApi.collectRows(query);
    const result = {};
    rows.forEach(r => { result[r._field] = r._value; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const range = (req.query.range && String(req.query.range)) || '-24h';
    // Comma-separated list of fields; default to a useful set
    const defaultFields = ['co2','temperature','humidity','dew_point','pm1_0','pm2_5','pm4_0','pm10','voc','nox','nc0_5','nc1_0','nc2_5','nc4_0','nc10'];
    const fields = (req.query.fields ? String(req.query.fields).split(',') : defaultFields).map(f => f.trim()).filter(Boolean);
    // Optional downsampling window, e.g. 1m, 5m, 10m. Empty means no aggregation
    const every = req.query.every ? String(req.query.every) : '';

    // Build Flux filter for fields
    const fieldFilter = fields.map(f => `r._field == "${f}"`).join(' or ');

    let flux = `from(bucket:"${bucket}") |> range(start:${range}) |> filter(fn:(r)=>r._measurement=="environment" and (${fieldFilter}))`;
    if (every) {
      // Use mean to reduce noise for longer ranges
      flux += ` |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`;
    }

    const rows = await queryApi.collectRows(flux);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Index history: returns computed rows for selected indices (voc_index, co2_index, pm_index)
app.get('/api/index/history', async (req, res) => {
  try {
    const range = (req.query.range && String(req.query.range)) || '-24h';
    const every = req.query.every ? String(req.query.every) : '';
    const requested = (req.query.fields ? String(req.query.fields).split(',') : ['voc_index','co2_index','pm_index']).map(s => s.trim()).filter(Boolean);

    const needVOC = requested.includes('voc_index');
    const needCO2 = requested.includes('co2_index');
    const needPM = requested.includes('pm_index');

    const baseFields = [];
    if (needVOC) baseFields.push('voc');
    if (needCO2) baseFields.push('co2');
    if (needPM) baseFields.push('pm2_5','pm10');

    if (!baseFields.length) return res.json([]);

    let flux = `from(bucket:"${bucket}") |> range(start:${range}) |> filter(fn:(r)=>r._measurement=="environment" and contains(value: r._field, set: ["${baseFields.join('\",\"')}"]))`;
    if (every) {
      flux += ` |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`;
    }
    flux += ` |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")`;

    const table = await queryApi.collectRows(flux);
    const rows = [];
    for (const r of table) {
      if (needVOC) {
        const v = computeVOCIndex(r.voc);
        if (v != null) rows.push({ _time: r._time, _field: 'voc_index', _value: Math.round(v) });
      }
      if (needCO2) {
        const c = computeCO2Index(r.co2);
        if (c != null) rows.push({ _time: r._time, _field: 'co2_index', _value: Math.round(c) });
      }
      if (needPM) {
        const p = computePMIndex(r);
        if (p != null) rows.push({ _time: r._time, _field: 'pm_index', _value: Math.round(p) });
      }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Current PMX calculated from last 12 hourly means
app.get('/api/pmx/current', async (req, res) => {
  try {
    const flux = `from(bucket:"${bucket}") |> range(start:-12h) |> filter(fn:(r)=>r._measurement=="environment" and contains(value: r._field, set: ["pm1_0","pm2_5","pm4_0","pm10"])) |> aggregateWindow(every: 1h, fn: mean, createEmpty: false) |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value") |> sort(columns:["_time"], desc:true) |> limit(n:12)`;
    const table = await queryApi.collectRows(flux);
    const series = { pm1_0: [], pm2_5: [], pm4_0: [], pm10: [] };
    for (const r of table) {
      if (r.pm1_0 != null) series.pm1_0.push(r.pm1_0);
      if (r.pm2_5 != null) series.pm2_5.push(r.pm2_5);
      if (r.pm4_0 != null) series.pm4_0.push(r.pm4_0);
      if (r.pm10 != null) series.pm10.push(r.pm10);
    }
    const result = computePMX(series);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Current IAQ calculated from latest values
app.get('/api/iaq/current', async (req, res) => {
  try {
    const query = `from(bucket:"${bucket}") |> range(start:-5m) |> filter(fn:(r)=>r._measurement=="environment") |> last()`;
    const rows = await queryApi.collectRows(query);
    const fields = {};
    rows.forEach(r => { fields[r._field] = r._value; });
    const iaq = computeIAQ(fields);
    res.json({ iaq, components: {
      pm2_5: fields.pm2_5 != null ? scorePM25(fields.pm2_5) : null,
      pm10:  fields.pm10  != null ? scorePM10(fields.pm10)   : null,
      co2:   fields.co2   != null ? scoreCO2(fields.co2)     : null,
      voc:   fields.voc   != null ? scoreVOCIndex(fields.voc) : null,
      nox:   fields.nox   != null ? scoreNOxIndex(fields.nox) : null,
    }, raw: fields });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Current indices (0..100): voc_index, co2_index, pm_index
app.get('/api/index/current', async (req, res) => {
  try {
    const query = `from(bucket:"${bucket}") |> range(start:-5m) |> filter(fn:(r)=>r._measurement=="environment") |> last()`;
    const rows = await queryApi.collectRows(query);
    const fields = {};
    rows.forEach(r => { fields[r._field] = r._value; });
    const voc_index = computeVOCIndex(fields.voc);
    const co2_index = computeCO2Index(fields.co2);
    const pm_index = computePMIndex(fields);
    res.json({ voc_index: voc_index == null ? null : Math.round(voc_index), co2_index: co2_index == null ? null : Math.round(co2_index), pm_index: pm_index == null ? null : Math.round(pm_index) });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// IAQ history: returns rows [{ _time, _field:'iaq', _value }]
app.get('/api/iaq/history', async (req, res) => {
  try {
    const range = (req.query.range && String(req.query.range)) || '-24h';
    const every = req.query.every ? String(req.query.every) : '';
    const fields = ['co2','pm2_5','pm10','voc','nox'];

    let flux = `from(bucket:"${bucket}") |> range(start:${range}) |> filter(fn:(r)=>r._measurement=="environment" and contains(value: r._field, set: ["${fields.join('\",\"')}"]))`;
    if (every) {
      flux += ` |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`;
    }
    flux += ` |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")`;

    const table = await queryApi.collectRows(flux);
    const rows = [];
    for (const r of table) {
      const iaq = computeIAQ(r);
      if (iaq != null) rows.push({ _time: r._time, _field: 'iaq', _value: iaq });
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(port, () => console.log(`Dashboard listening on port ${port}`));
