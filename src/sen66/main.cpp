// src/main.cpp
#include "Sen66.h"
#include "config.h"
#include <Arduino.h>
#include <ArduinoOTA.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>

Sen66 sen66(Wire);

unsigned long lastSend = 0;
unsigned long lastFanCleaning = 0;

class VentilationDetector {
public:
  void addSample(float co2) {
    if (isnan(co2))
      return;

    // Shift history
    for (int i = VENTILATION_WINDOW_SIZE - 1; i > 0; i--) {
      history[i] = history[i - 1];
    }
    history[0] = co2;

    if (count < VENTILATION_WINDOW_SIZE) {
      count++;
    }

    // Update peak value (highest CO2 seen recently)
    if (co2 > peakValue) {
      peakValue = co2;
      peakAge = 0;
    } else {
      peakAge++;
    }

    // Reset peak if it's too old (no longer "recent")
    if (peakAge >= VENTILATION_WINDOW_SIZE) {
      peakValue = co2;
      peakAge = 0;
    }
  }

  bool isVentilationDetected() {
    if (count < 2)
      return false;

    // Calculate drop from recent peak to current value
    float drop = peakValue - history[0];
    if (drop >= VENTILATION_CO2_DROP_THRESHOLD) {
      Serial.printf(
          "Ventilation Detected! Drop: %.0f ppm (Peak: %.0f -> Curr: %.0f)\n",
          drop, peakValue, history[0]);
      // Reset peak to prevent multiple triggers for same ventilation event
      peakValue = history[0];
      peakAge = 0;
      return true;
    }
    return false;
  }

private:
  float history[VENTILATION_WINDOW_SIZE];
  int count = 0;
  float peakValue = 0;
  int peakAge = 0;
};

VentilationDetector ventilationDetector;

static void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(400);
    if (millis() - t0 > 20000)
      break;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FAILED");
  }
}

static void setupOTA() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    String type;
    if (ArduinoOTA.getCommand() == U_FLASH)
      type = "sketch";
    else // U_SPIFFS
      type = "filesystem";
    Serial.println("Start updating " + type);
  });
  ArduinoOTA.onEnd([]() { Serial.println("\nEnd"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("Error[%u]: ", error);
    if (error == OTA_AUTH_ERROR)
      Serial.println("Auth Failed");
    else if (error == OTA_BEGIN_ERROR)
      Serial.println("Begin Failed");
    else if (error == OTA_CONNECT_ERROR)
      Serial.println("Connect Failed");
    else if (error == OTA_RECEIVE_ERROR)
      Serial.println("Receive Failed");
    else if (error == OTA_END_ERROR)
      Serial.println("End Failed");
  });

  ArduinoOTA.begin();
  Serial.println("OTA Ready");
}

void setup() {
  Serial.begin(115200);
  delay(200);

  sen66.begin();

  delay(1000);

  // Start fan cleaning (uncomment to enable on boot)
  // stopMeasurement/restore is now handled inside startFanCleaning
  if (sen66.startFanCleaning()) {
    Serial.println("Fan cleaning started... (library handles wait)");
  } else {
    Serial.println("Fan cleaning failed");
  }

  if (!sen66.startMeasurement()) {
    Serial.println("SEN66 startMeasurement() failed");
  }

  // Configure Temperature Offset (Offset=0, Slope=0, TimeConstant=0 for now)
  // This compensates for self-heating or enclosure effects.
  if (!sen66.setTemperatureOffsetParameters(0, 0, 0)) {
    Serial.println("SEN66 setTemperatureOffsetParameters() failed");
  }

  wifiConnect();
  setupOTA();
}

static String f2s(float v, uint8_t digits = 2) {
  if (isnan(v))
    return "";
  // Disambiguate constructor by casting to unsigned int
  return String(v, static_cast<unsigned int>(digits));
}

static float dewPoint(float tempC, float humidityRH) {
  if (isnan(tempC) || isnan(humidityRH))
    return NAN;
  const float a = 17.62f;
  const float b = 243.12f;
  float gamma = (a * tempC) / (b + tempC) + log(humidityRH / 100.0f);
  return (b * gamma) / (a - gamma);
}

static void sendToInflux(const Sen66::MeasuredValues &mv,
                         const Sen66::NumberConcentration &nc,
                         uint32_t statusFlags) {
  if (WiFi.status() != WL_CONNECTED)
    return;
  HTTPClient http;
  String url = String(INFLUXDB_URL) +
               "/api/v2/write?bucket=" + INFLUXDB_BUCKET +
               "&org=" + INFLUXDB_ORG;
  const float dp = dewPoint(mv.temperature_c, mv.humidity_rh);
  String line =
      String("environment") + " pm1_0=" + f2s(mv.pm1_0, 1) +
      ",pm2_5=" + f2s(mv.pm2_5, 1) + ",pm4_0=" + f2s(mv.pm4_0, 1) +
      ",pm10=" + f2s(mv.pm10_0, 1) + ",humidity=" + f2s(mv.humidity_rh, 2) +
      ",temperature=" + f2s(mv.temperature_c, 2) + ",dew_point=" + f2s(dp, 2) +
      ",voc=" + f2s(mv.voc_index, 1) + ",nox=" + f2s(mv.nox_index, 1) +
      ",co2=" + f2s(mv.co2_ppm, 0) + ",nc0_5=" + f2s(nc.nc0_5, 1) +
      ",nc1_0=" + f2s(nc.nc1_0, 1) + ",nc2_5=" + f2s(nc.nc2_5, 1) +
      ",nc4_0=" + f2s(nc.nc4_0, 1) + ",nc10=" + f2s(nc.nc10_0, 1) +
      ",status=" + String((unsigned long)statusFlags);
  http.begin(url);
  http.addHeader("Authorization", String("Token ") + INFLUXDB_TOKEN);
  http.addHeader("Content-Type", "text/plain; charset=utf-8");
  int code = http.POST(line);
  Serial.printf("[InfluxDB] HTTP %d\n", code);
  http.end();
}

static void sendFanCleaningEventToInflux() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  HTTPClient http;
  String url = String(INFLUXDB_URL) +
               "/api/v2/write?bucket=" + INFLUXDB_BUCKET +
               "&org=" + INFLUXDB_ORG;
  String line = String("events,type=fan_cleaning value=1");
  http.begin(url);
  http.addHeader("Authorization", String("Token ") + INFLUXDB_TOKEN);
  http.addHeader("Content-Type", "text/plain; charset=utf-8");
  int code = http.POST(line);
  Serial.printf("[InfluxDB] Fan Cleaning Event HTTP %d\n", code);
  http.end();
}

void loop() {
  ArduinoOTA.handle();
  bool ready = false;
  if (!sen66.dataReady(ready)) {
    Serial.println("dataReady() error");
    delay(250);
    return;
  }
  if (!ready) {
    delay(50);
    return;
  }

  Sen66::MeasuredValues mv{};
  Sen66::NumberConcentration nc{};
  uint32_t statusFlags = 0;

  if (!sen66.readMeasuredValues(mv)) {
    Serial.println("readMeasuredValues() failed, retrying...");
    delay(50);
    if (!sen66.readMeasuredValues(mv)) {
      Serial.println("readMeasuredValues() failed again");
      delay(200);
      return;
    }
  }
  if (!sen66.readNumberConcentration(nc)) {
    Serial.println("readNumberConcentration() failed");
    delay(200);
    return;
  }
  if (!sen66.readDeviceStatus(statusFlags)) {
    Serial.println("readDeviceStatus() failed");
  }

  const float dp = dewPoint(mv.temperature_c, mv.humidity_rh);
  Serial.printf("PM1.0=%.1f PM2.5=%.1f PM4.0=%.1f PM10=%.1f ug/m3 | RH=%.2f%% "
                "T=%.2fC DP=%.2fC | VOC=%.1f NOx=%.1f | CO2=%.0f ppm\n",
                mv.pm1_0, mv.pm2_5, mv.pm4_0, mv.pm10_0, mv.humidity_rh,
                mv.temperature_c, dp, mv.voc_index, mv.nox_index, mv.co2_ppm);
  Serial.printf("NC0.5=%.1f NC1.0=%.1f NC2.5=%.1f NC4.0=%.1f NC10=%.1f #/cm3 | "
                "Status=0x%08lX\n",
                nc.nc0_5, nc.nc1_0, nc.nc2_5, nc.nc4_0, nc.nc10_0, statusFlags);

  // Ventilation Detection & Automatic Fan Cleaning
  if (mv.valid_co2) {
    ventilationDetector.addSample(mv.co2_ppm);
    if (ventilationDetector.isVentilationDetected()) {
      const unsigned long now = millis();
      if (now - lastFanCleaning > FAN_CLEANING_COOLDOWN_MS ||
          lastFanCleaning == 0) {
        Serial.println("Triggering Fan Cleaning due to ventilation event...");
        // stopMeasurement/restore is now integrated into startFanCleaning
        if (sen66.startFanCleaning()) {
          Serial.println("Fan cleaning finished (state restored).");
          sendFanCleaningEventToInflux();
          lastFanCleaning = now;
        } else {
          Serial.println("Failed to start fan cleaning.");
        }
        // No need to manual startMeasurement here
      }
    }
  }

  const unsigned long now = millis();
  if (now - lastSend < MEASUREMENT_INTERVAL_MS) {
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
