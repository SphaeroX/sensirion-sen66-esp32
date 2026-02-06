# Sensirion SEN66 Project

This project is a complete ecosystem for monitoring and visualizing air quality data using the Sensirion SEN66 sensor. It consists of four main components interacting with each other to provide real-time environment data.

## Components

### 1. Sensor Node (`src/sen66`)
The core of the project. It uses a **Seeed Studio XIAO ESP32-S3** controller connected to a **Sensirion SEN66** sensor.
*   **Function**: Reads environmental data (PM1.0, PM2.5, PM4.0, PM10, VOC, NOx, CO2, Humidity, Temperature).
*   **Connectivity**: Connects to WiFi and uploads all measured data to an **InfluxDB** instance.
*   **OTA**: Supports Over-The-Air updates.

### 2. Air Quality Lamp (`src/lamp`)
A visual indicator for air quality.
*   **Function**: Displays the current Air Quality Index (IAQ) using an LED ring.
*   **Hardware**: ESP32 based controller with an LED ring (e.g., WS2812B) and optionally an OLED display.
*   **Data Source**: Queries the latest data from InfluxDB to determine the color/status of the LEDs.

### 3. Dashboard (`dashboard/`)
A web application for data visualization.
*   **Function**: Provides a comprehensive dashboard to view historical and real-time air quality data.
*   **Hosting**: Designed to be hosted for free on **Azure App Service**.
*   **Stack**: Node.js/Express backend that interfaces with InfluxDB.

### 4. Android Widget (`android_widget/`)
A mobile companion app.
*   **Function**: An Android application that provides home screen widgets.
*   **Features**: Displays current air quality metrics directly on your phone's home screen without opening the app.

---

## Installation & Configuration

### 1. Prerequisites
*   PlatformIO installed (VS Code extension recommended).
*   An InfluxDB v2 instance (cloud or self-hosted).
*   WiFi credentials.

### 2. Configuration (`.env`)
The project uses a `.env` file to manage configuration, which is automatically converted to `include/config.h` during the build process.

1.  Copy `.env.example` to `.env` in the project root.
2.  Edit `.env` and fill in your credentials:

```ini
# WiFi
WIFI_SSID="YOUR_WIFI_SSID"
WIFI_PASSWORD="YOUR_WIFI_PASSWORD"

# InfluxDB
INFLUXDB_URL="https://eu-central-1-1.aws.cloud2.influxdata.com"
INFLUXDB_ORG="YOUR_INFLUXDB_ORG"
INFLUXDB_BUCKET="sen66"
INFLUXDB_TOKEN="YOUR_INFLUXDB_TOKEN"

# OTA
OTA_HOSTNAME="sen66-esp32"
OTA_PASSWORD="admin"

# Ventilation Detection
VENTILATION_CO2_DROP_THRESHOLD=100
VENTILATION_WINDOW_SIZE=5
FAN_CLEANING_COOLDOWN_MS=900000
```
**Note:** Do not create `include/config.h` manually, it will be overwritten.


### 3. Building and Flashing

#### Sensor Node
1.  Open the project in PlatformIO.
2.  Select the `sen66` environment (if applicable, or default environment).
3.  Connect your XIAO ESP32-S3.
4.  Run **Upload**.

#### Lamp
1.  Open the project in PlatformIO.
2.  Target the `lamp` source code (check `platformio.ini` `src_dir` or environment settings if separated).
3.  Connect your Lamp ESP32.
4.  Run **Upload**.

---

## Deployment

### Dashboard on Azure
The `dashboard` folder contains a Node.js app ready for Azure.
1.  Create a wrapper Web App on Azure (Free tier works).
2.  Deploy the contents of the `dashboard/` folder.
3.  Set the Environment Variables in Azure App Service configuration to match your InfluxDB credentials (check `dashboard/README.md` if available for specific env var names).

### Android Widget
1.  Open the `android_widget` project in **Android Studio**.
2.  Build and install the APK on your Android device.
3.  Add the widget to your home screen.

---

## Troubleshooting

### Flashing Error: "A fatal error occurred: No serial data received."

If you encounter this error when trying to flash the ESP32:

**Solution:**

1.  **Disconnect** the controller from USB
2.  **Hold down** the **BOOT** button (on the XIAO ESP32-S3, this is the small button next to the USB-C port)
3.  While holding BOOT, **connect** the controller to USB
4.  **Start the upload** process in PlatformIO (or your IDE)
5.  Keep holding the BOOT button until you see the message **"Looking for port..."** or similar in the upload logs
6.  **Release** the BOOT button
7.  The upload should now proceed successfully

**Why this works:** The ESP32 needs to be in bootloader mode to accept new firmware. Holding BOOT during power-on forces it into this mode.
