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

app.get('/api/current', async (req, res) => {
  try {
    const query = `from(bucket:"${bucket}") |> range(start:-5m) |> filter(fn:(r)=>r._measurement=="environment") |> last()`;
    const rows = [];
    await queryApi.collectRows(query, rows);
    const result = {};
    rows.forEach(r => { result[r._field] = r._value; });
    res.json(result);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const query = `from(bucket:"${bucket}") |> range(start:-24h) |> filter(fn:(r)=>r._measurement=="environment" and r._field=="co2")`;
    const rows = [];
    await queryApi.collectRows(query, rows);
    res.json(rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(port, () => console.log(`Dashboard listening on port ${port}`));
