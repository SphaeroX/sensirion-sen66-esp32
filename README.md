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

### 2. Configuration (`include/config.h`)
You need to create a configuration file to store your credentials. This file is ignored by git to keep your secrets safe.

1.  Navigate to the `include/` directory.
2.  Create a new file named `config.h`.
3.  Copy the following template and fill in your details:

```c
#ifndef CONFIG_H
#define CONFIG_H

// WiFi Configuration
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// InfluxDB Configuration
#define INFLUXDB_URL "https://eu-central-1-1.aws.cloud2.influxdata.com"
#define INFLUXDB_ORG "YOUR_INFLUXDB_ORG"
#define INFLUXDB_BUCKET "YOUR_INFLUXDB_BUCKET"
#define INFLUXDB_TOKEN "YOUR_INFLUXDB_TOKEN"

// OTA Update Configuration
#define OTA_HOSTNAME "sen66-esp32"
#define OTA_PASSWORD "admin"

// Measurement Interval
#define MEASUREMENT_INTERVAL_MS 60000

#endif // CONFIG_H
```

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
