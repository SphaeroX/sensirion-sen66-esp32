import os
from pathlib import Path

try:  # Running under PlatformIO's SCons environment
    Import("env")
    ROOT = Path(env["PROJECT_DIR"])
except NameError:  # Fallback for direct execution
    ROOT = Path(__file__).resolve().parent.parent

CONFIG = ROOT / "include" / "config.h"


def get(name, default=""):
    return os.environ.get(name, default)


template = f"""// generated from environment variables
#pragma once

// ===== WiFi credentials =====
#define WIFI_SSID \"{get('WIFI_SSID')}\"
#define WIFI_PASSWORD \"{get('WIFI_PASSWORD')}\"

#define MEASUREMENT_INTERVAL_MS {get('MEASUREMENT_INTERVAL_MS', '20000')}UL

// ===== InfluxDB v2 setup =====
#define INFLUXDB_URL \"{get('INFLUXDB_URL')}\"
#define INFLUXDB_ORG \"{get('INFLUXDB_ORG')}\"
#define INFLUXDB_BUCKET \"{get('INFLUXDB_BUCKET')}\"
#define INFLUXDB_TOKEN \"{get('INFLUXDB_TOKEN')}\"
"""

CONFIG.write_text(template)
print(f"Wrote {CONFIG}")
