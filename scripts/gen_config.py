import os
from pathlib import Path

try:  # Running under PlatformIO's SCons environment
    Import("env")
    ROOT = Path(env["PROJECT_DIR"])
except NameError:  # Fallback for direct execution
    ROOT = Path(__file__).resolve().parent.parent

CONFIG = ROOT / "include" / "config.h"


def load_dotenv(path: Path) -> None:
    """Load simple KEY=VALUE pairs from a .env file into os.environ.

    - Ignores empty lines and lines starting with '#'
    - Respects surrounding single or double quotes
    - Does not override already-set environment variables
    """
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        # Do not clobber existing values
        if key and key not in os.environ:
            os.environ[key] = value


def c_string(value: str) -> str:
    """Escape a Python string for safe use inside a C string literal."""
    return value.replace("\\", "\\\\").replace("\"", "\\\"")


def get(name, default=""):
    return os.environ.get(name, default)


# Load .env from project root so values are available during PlatformIO builds
load_dotenv(ROOT / ".env")

template = f"""// generated from environment variables
#pragma once

// ===== WiFi credentials =====
#define WIFI_SSID \"{c_string(get('WIFI_SSID'))}\"
#define WIFI_PASSWORD \"{c_string(get('WIFI_PASSWORD'))}\"

#define MEASUREMENT_INTERVAL_MS {get('MEASUREMENT_INTERVAL_MS', '20000')}UL

// ===== OTA =====
#define OTA_HOSTNAME "{get('OTA_HOSTNAME', 'sen66-esp32')}"
#define OTA_PASSWORD "{get('OTA_PASSWORD', 'admin')}"

// ===== Ventilation Detection =====

#define VENTILATION_CO2_DROP_THRESHOLD {get('VENTILATION_CO2_DROP_THRESHOLD', '100')} // ppm
#define VENTILATION_WINDOW_SIZE {get('VENTILATION_WINDOW_SIZE', '5')}          // number of samples
#define FAN_CLEANING_COOLDOWN_MS {get('FAN_CLEANING_COOLDOWN_MS', '900000')}    // 15 minutes


// ===== InfluxDB v2 setup =====
#define INFLUXDB_URL \"{c_string(get('INFLUXDB_URL'))}\"
#define INFLUXDB_ORG \"{c_string(get('INFLUXDB_ORG'))}\"
#define INFLUXDB_BUCKET \"{c_string(get('INFLUXDB_BUCKET'))}\"
#define INFLUXDB_TOKEN \"{c_string(get('INFLUXDB_TOKEN'))}\"

// ===== External Weather/AQI Configuration =====
// Set to 1 to enable weather data fetching from Open-Meteo (free, no API key needed)
#define WEATHER_ENABLED {1 if get('WEATHER_ENABLED', 'true').lower() in ('true', '1', 'yes') else 0}
// Location coordinates - find your city at: https://open-meteo.com/en/docs
#define WEATHER_LATITUDE \"{c_string(get('WEATHER_LATITUDE', '52.52'))}\"
#define WEATHER_LONGITUDE \"{c_string(get('WEATHER_LONGITUDE', '13.405'))}\"
"""

CONFIG.write_text(template, encoding="utf-8")
print(f"Wrote {CONFIG}")
