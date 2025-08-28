import os
from pathlib import Path

Import("env")
ROOT = Path(env["PROJECT_DIR"])
CONFIG = ROOT / 'include' / 'config.h'

def get(name, default=''):
    return os.environ.get(name, default)

template = f"""// generated from environment variables
#pragma once

// ===== WiFi credentials =====
#define WIFI_SSID \"{get('WIFI_SSID')}\"
#define WIFI_PASSWORD \"{get('WIFI_PASSWORD')}\"

// ===== ThingSpeak setup =====
#define TS_CHANNEL_A_ID {get('TS_CHANNEL_A_ID', '0')}UL
#define TS_CHANNEL_A_APIKEY \"{get('TS_CHANNEL_A_APIKEY')}\"

#define TS_CHANNEL_B_ID {get('TS_CHANNEL_B_ID', '0')}UL
#define TS_CHANNEL_B_APIKEY \"{get('TS_CHANNEL_B_APIKEY')}\"

#define MEASUREMENT_INTERVAL_MS {get('MEASUREMENT_INTERVAL_MS', '20000')}UL

// ===== InfluxDB v2 setup =====
#define INFLUXDB_URL \"{get('INFLUXDB_URL')}\"
#define INFLUXDB_ORG \"{get('INFLUXDB_ORG')}\"
#define INFLUXDB_BUCKET \"{get('INFLUXDB_BUCKET')}\"
#define INFLUXDB_TOKEN \"{get('INFLUXDB_TOKEN')}\"
"""

CONFIG.write_text(template)
