## Dashboard

Express.js server that queries InfluxDB on the server side and serves a mobile friendly dashboard.

### Configuration

Credentials are taken from the repository root `.env` file. Use `cp ../.env.example ../.env` and fill in your values once for both firmware and dashboard.

### Development

```
npm install
npm test
npm start
```

The server listens on port 3000 by default.

### Features

- Default view shows the last 24 hours.
- Change time range via presets or a custom Flux-style range string (e.g. `-12h`, `-3d`).
- Optional downsampling with 1m/5m/15m/1h aggregate windows.
- Toggle multiple series: CO2, temperature, humidity, PM2.5, PM10, VOC, NOx.
- Smooth, interactive charts powered by ApexCharts.
 - IAQ composite index (0–100) derived from PM2.5/PM10/CO2/VOC/NOx using conservative max-of-subscores.
- Optional Chatbot powered by OpenAI: enter your API key in the dashboard to ask questions about current sensor values (automatically sent with each chat request), use speech input, web search and audio replies from the ChatGPT 5 model.

### API

- `GET /api/current` → Latest values for all fields.
- `GET /api/history?range=-24h&fields=co2,temperature&every=1m`
  - `range`: Flux range start (default `-24h`).
  - `fields`: comma separated field list (default `co2,temperature,humidity,pm2_5,pm10,voc,nox`).
  - `every`: optional aggregate window (e.g. `1m`, `5m`).
 - `GET /api/iaq/current` → Latest IAQ score and component scores.
 - `GET /api/iaq/history?range=-24h&every=1m` → Time series of IAQ values.

### IAQ Scoring

Scores each pollutant on a 0–100 scale (higher is worse) and takes the maximum as overall IAQ to avoid masking a single bad pollutant.

- PM2.5 (µg/m³): 0–10→0–20, 10–25→20–50, 25–50→50–75, 50–75→75–90, >75→100.
- PM10 (µg/m³): 0–20→0–20, 20–45→20–60, 45–100→60–90, >100→100.
- CO2 (ppm): 400–800→0–20, 800–1000→20–40, 1000–1400→40–70, 1400–2000→70–90, >2000→100.
- VOC index: ≤100≈10, 100–200→10–60, 200–300→60–85, 300–500→85–100.
- NOx index: similar to VOC index.

### Deploy to Microsoft Azure (Free Tier)

You can run this Express server on Azure App Service using the Free (F1) plan (where available). This keeps costs at zero for small workloads. The app reads `PORT` from the environment, which Azure provides automatically.

Prerequisites

- Azure account and Azure CLI installed (`az --version`)
- InfluxDB v2 credentials (URL, ORG, BUCKET, TOKEN)

Steps (Bash/PowerShell compatible; replace values in angle brackets)

1) Login and set variables

```
az login
set RG=sen66-rg
set LOCATION=westeurope
set PLAN=sen66-plan
set APP=sen66-dashboard-<your-unique-suffix>
```

2) Create resource group and Free (F1) Linux plan

```
az group create --name %RG% --location %LOCATION%
az appservice plan create --name %PLAN% --resource-group %RG% --sku F1 --is-linux
```

3) Create the web app (Node 18 LTS)

```
az webapp create --resource-group %RG% --plan %PLAN% --name %APP% --runtime "NODE|18-lts"
```

4) Configure environment variables (from your repo root `.env`)

```
az webapp config appsettings set ^
  --resource-group %RG% ^
  --name %APP% ^
  --settings ^
    INFLUXDB_URL=<your-url> ^
    INFLUXDB_TOKEN=<your-token> ^
    INFLUXDB_ORG=<your-org> ^
    INFLUXDB_BUCKET=<your-bucket>
```

5) Deploy the `dashboard/` app (Zip Deploy)

PowerShell:

```
cd dashboard
Compress-Archive -Path * -DestinationPath app.zip -Force
az webapp deployment source config-zip --resource-group %RG% --name %APP% --src app.zip
```

Bash (Git Bash/WSL):

```
cd dashboard
zip -r app.zip .
az webapp deployment source config-zip --resource-group $RG --name $APP --src app.zip
```

6) Open the app

```
echo https://%APP%.azurewebsites.net
```

Notes

- Free (F1) has limited resources and may cold‑start after inactivity.
- Do not rely on local filesystem persistence (ephemeral). Configuration goes into App Settings.
- Ensure outbound access from Azure to your InfluxDB instance (allowlist if applicable).

For more details about local development and API, see this file and the root README. The root contains broader project information; the dashboard section there links back here.
