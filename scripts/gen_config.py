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

// ===== InfluxDB v2 setup =====
#define INFLUXDB_URL \"{c_string(get('INFLUXDB_URL'))}\"
#define INFLUXDB_ORG \"{c_string(get('INFLUXDB_ORG'))}\"
#define INFLUXDB_BUCKET \"{c_string(get('INFLUXDB_BUCKET'))}\"
#define INFLUXDB_TOKEN \"{c_string(get('INFLUXDB_TOKEN'))}\"
"""

CONFIG.write_text(template, encoding="utf-8")
print(f"Wrote {CONFIG}")
