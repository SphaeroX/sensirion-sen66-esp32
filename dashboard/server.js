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
