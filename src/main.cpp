// src/main.cpp
#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include "config.h"
#include "Sen66.h"
#include <HTTPClient.h>

Sen66 sen66(Wire);

unsigned long lastSend = 0;

static void wifiConnect()
{
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED)
  {
    Serial.print(".");
    delay(400);
    if (millis() - t0 > 20000)
      break;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("WiFi FAILED");
  }
}

void setup()
{
  Serial.begin(115200);
  delay(200);

  sen66.begin();

  if (!sen66.startMeasurement())
  {
    Serial.println("SEN66 startMeasurement() failed");
  }

  wifiConnect();
}

static String f2s(float v, uint8_t digits = 2)
{
  if (isnan(v))
    return "";
  // Disambiguate constructor by casting to unsigned int
  return String(v, static_cast<unsigned int>(digits));
}

static void sendToInflux(const Sen66::MeasuredValues &mv, const Sen66::NumberConcentration &nc, uint32_t statusFlags)
{
  if (WiFi.status() != WL_CONNECTED)
    return;
  HTTPClient http;
  String url = String(INFLUXDB_URL) + "/api/v2/write?bucket=" + INFLUXDB_BUCKET + "&org=" + INFLUXDB_ORG;
  String line = String("environment") +
                " pm1_0=" + f2s(mv.pm1_0, 1) +
                ",pm2_5=" + f2s(mv.pm2_5, 1) +
                ",pm4_0=" + f2s(mv.pm4_0, 1) +
                ",pm10=" + f2s(mv.pm10_0, 1) +
                ",humidity=" + f2s(mv.humidity_rh, 2) +
                ",temperature=" + f2s(mv.temperature_c, 2) +
                ",voc=" + f2s(mv.voc_index, 1) +
                ",nox=" + f2s(mv.nox_index, 1) +
                ",co2=" + f2s(mv.co2_ppm, 0) +
                ",nc0_5=" + f2s(nc.nc0_5, 1) +
                ",nc1_0=" + f2s(nc.nc1_0, 1) +
                ",nc2_5=" + f2s(nc.nc2_5, 1) +
                ",nc4_0=" + f2s(nc.nc4_0, 1) +
                ",nc10="  + f2s(nc.nc10_0, 1) +
                ",status=" + String((unsigned long)statusFlags);
  http.begin(url);
  http.addHeader("Authorization", String("Token ") + INFLUXDB_TOKEN);
  http.addHeader("Content-Type", "text/plain; charset=utf-8");
  int code = http.POST(line);
  Serial.printf("[InfluxDB] HTTP %d\n", code);
  http.end();
}

void loop()
{
  bool ready = false;
  if (!sen66.dataReady(ready))
  {
    Serial.println("dataReady() error");
    delay(250);
    return;
  }
  if (!ready)
  {
    delay(50);
    return;
  }

  Sen66::MeasuredValues mv{};
  Sen66::NumberConcentration nc{};
  uint32_t statusFlags = 0;

  if (!sen66.readMeasuredValues(mv))
  {
    Serial.println("readMeasuredValues() failed");
    delay(200);
    return;
  }
  if (!sen66.readNumberConcentration(nc))
  {
    Serial.println("readNumberConcentration() failed");
    delay(200);
    return;
  }
  if (!sen66.readDeviceStatus(statusFlags))
  {
    Serial.println("readDeviceStatus() failed");
  }

  Serial.printf("PM1.0=%.1f PM2.5=%.1f PM4.0=%.1f PM10=%.1f ug/m3 | RH=%.2f%% T=%.2fC | VOC=%.1f NOx=%.1f | CO2=%.0f ppm\n",
                mv.pm1_0, mv.pm2_5, mv.pm4_0, mv.pm10_0,
                mv.humidity_rh, mv.temperature_c, mv.voc_index, mv.nox_index, mv.co2_ppm);
  Serial.printf("NC0.5=%.1f NC1.0=%.1f NC2.5=%.1f NC4.0=%.1f NC10=%.1f #/cm3 | Status=0x%08lX\n",
                nc.nc0_5, nc.nc1_0, nc.nc2_5, nc.nc4_0, nc.nc10_0, statusFlags);

  const unsigned long now = millis();
  if (now - lastSend < MEASUREMENT_INTERVAL_MS)
  {
    delay(50);
    return;
  }
  lastSend = now;

    if (WiFi.status() != WL_CONNECTED)
    wifiConnect();
    if (WiFi.status() != WL_CONNECTED)
    return;

    sendToInflux(mv, nc, statusFlags);
  }
