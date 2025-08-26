// include/config.h
#pragma once

// ===== WiFi credentials =====
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ===== ThingSpeak setup =====
// Channel A (8 fields max): PM1.0, PM2.5, PM4.0, PM10, RH, Temp, VOC Index, NOx Index
#define TS_CHANNEL_A_ID 0000000UL
#define TS_CHANNEL_A_APIKEY "YOUR_API_KEY_A"

// Channel B (8 fields max): CO2, NC0.5, NC1.0, NC2.5, NC4.0, NC10, StatusFlags, (free)
#define TS_CHANNEL_B_ID 0000000UL
#define TS_CHANNEL_B_APIKEY "YOUR_API_KEY_B"

// ===== Update interval (ThingSpeak free tier min ~15 s) =====
#define MEASUREMENT_INTERVAL_MS 20000UL
