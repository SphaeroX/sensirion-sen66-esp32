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
