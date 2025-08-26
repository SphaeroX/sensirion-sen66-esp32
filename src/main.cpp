// src/main.cpp
#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <vector> // for std::vector
#include "config.h"
#include "Sen66.h"
#include "ThingSpeakClient.h"

Sen66 sen66(Wire);
ThingSpeakClient ts;

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

  {
    std::vector<std::pair<uint8_t, String>> fieldsA;
    fieldsA.push_back({1, f2s(mv.pm1_0, 1)});
    fieldsA.push_back({2, f2s(mv.pm2_5, 1)});
    fieldsA.push_back({3, f2s(mv.pm4_0, 1)});
    fieldsA.push_back({4, f2s(mv.pm10_0, 1)});
    fieldsA.push_back({5, f2s(mv.humidity_rh, 2)});
    fieldsA.push_back({6, f2s(mv.temperature_c, 2)});
    fieldsA.push_back({7, f2s(mv.voc_index, 1)});
    fieldsA.push_back({8, f2s(mv.nox_index, 1)});

    String respA;
    bool okA = ts.update(TS_CHANNEL_A_ID, TS_CHANNEL_A_APIKEY, fieldsA, "", &respA);
    Serial.println(okA ? "[TS A] OK" : "[TS A] FAIL");
  }

  {
    std::vector<std::pair<uint8_t, String>> fieldsB;
    fieldsB.push_back({1, f2s(mv.co2_ppm, 0)});
    fieldsB.push_back({2, f2s(nc.nc0_5, 1)});
    fieldsB.push_back({3, f2s(nc.nc1_0, 1)});
    fieldsB.push_back({4, f2s(nc.nc2_5, 1)});
    fieldsB.push_back({5, f2s(nc.nc4_0, 1)});
    fieldsB.push_back({6, f2s(nc.nc10_0, 1)});
    fieldsB.push_back({7, String((unsigned long)statusFlags)});

    String respB;
    bool okB = ts.update(TS_CHANNEL_B_ID, TS_CHANNEL_B_APIKEY, fieldsB, "", &respB);
    Serial.println(okB ? "[TS B] OK" : "[TS B] FAIL");
  }
}
