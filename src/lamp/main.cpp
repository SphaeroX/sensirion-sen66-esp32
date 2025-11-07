#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_SSD1306.h>
#include <math.h>
#include <stdio.h>

#include "config.h"

#ifndef LED_RING_PIN
#define LED_RING_PIN 2
#endif

#ifndef LED_RING_COUNT
#define LED_RING_COUNT 12
#endif

#ifndef OLED_SDA_PIN
#define OLED_SDA_PIN 5
#endif

#ifndef OLED_SCL_PIN
#define OLED_SCL_PIN 6
#endif

#ifndef OLED_I2C_ADDR
#define OLED_I2C_ADDR 0x3C
#endif

constexpr uint8_t OLED_WIDTH = 72;
constexpr uint8_t OLED_HEIGHT = 40;
constexpr int16_t OLED_X_OFFSET = 13;
constexpr int16_t OLED_Y_OFFSET = 14;

constexpr uint8_t LED_BRIGHTNESS = 128;
constexpr unsigned long IAQ_REFRESH_MS = 30000UL;
constexpr unsigned long WIFI_RETRY_DELAY_MS = 5000UL;

Adafruit_NeoPixel ring(LED_RING_COUNT, LED_RING_PIN, NEO_GRB + NEO_KHZ800);
Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
bool oledReady = false;

struct LatestFields
{
  float pm25 = NAN;
  float pm10 = NAN;
  float co2 = NAN;
  float voc = NAN;
  float nox = NAN;
};

unsigned long lastPoll = 0;

float clampf(float v, float a, float b)
{
  return (v < a) ? a : (v > b ? b : v);
}

float lin(float x, float x0, float x1, float y0, float y1)
{
  if (x <= x0)
    return y0;
  if (x >= x1)
    return y1;
  return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
}

float scorePM25(float v)
{
  if (!isfinite(v))
    return NAN;
  if (v <= 10)
    return lin(v, 0, 10, 0, 20);
  if (v <= 25)
    return lin(v, 10, 25, 20, 50);
  if (v <= 50)
    return lin(v, 25, 50, 50, 75);
  if (v <= 75)
    return lin(v, 50, 75, 75, 90);
  return 100;
}

float scorePM10(float v)
{
  if (!isfinite(v))
    return NAN;
  if (v <= 20)
    return lin(v, 0, 20, 0, 20);
  if (v <= 45)
    return lin(v, 20, 45, 20, 60);
  if (v <= 100)
    return lin(v, 45, 100, 60, 90);
  return 100;
}

float scoreCO2(float v)
{
  if (!isfinite(v))
    return NAN;
  if (v <= 800)
    return lin(v, 400, 800, 0, 20);
  if (v <= 1000)
    return lin(v, 800, 1000, 20, 40);
  if (v <= 1400)
    return lin(v, 1000, 1400, 40, 70);
  if (v <= 2000)
    return lin(v, 1400, 2000, 70, 90);
  return 100;
}

float scoreVOC(float v)
{
  if (!isfinite(v))
    return NAN;
  if (v <= 100)
    return 10;
  if (v <= 200)
    return lin(v, 100, 200, 10, 60);
  if (v <= 300)
    return lin(v, 200, 300, 60, 85);
  if (v <= 500)
    return lin(v, 300, 500, 85, 100);
  return 100;
}

float scoreNOx(float v)
{
  if (!isfinite(v))
    return NAN;
  if (v <= 100)
    return 10;
  if (v <= 200)
    return lin(v, 100, 200, 10, 60);
  if (v <= 300)
    return lin(v, 200, 300, 60, 85);
  if (v <= 500)
    return lin(v, 300, 500, 85, 100);
  return 100;
}

float computeIAQ(const LatestFields &f)
{
  float worst = NAN;
  const float scores[] = {
      scorePM25(f.pm25),
      scorePM10(f.pm10),
      scoreCO2(f.co2),
      scoreVOC(f.voc),
      scoreNOx(f.nox)};
  for (float s : scores)
  {
    if (isnan(s))
      continue;
    worst = isnan(worst) ? s : max(worst, s);
  }
  if (isnan(worst))
  {
    return NAN;
  }
  return clampf(worst, 0, 100);
}

void showSolid(uint32_t color)
{
  for (uint16_t i = 0; i < LED_RING_COUNT; ++i)
  {
    ring.setPixelColor(i, color);
  }
  ring.show();
}

void showHelloOnOled()
{
  if (!oledReady)
  {
    return;
  }
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(OLED_X_OFFSET, OLED_Y_OFFSET);
  oled.println("hello");
  oled.display();
}

void showOledStatus(const String &line1, const String &line2 = String())
{
  (void)line1;
  (void)line2;
  showHelloOnOled();
}

uint32_t colorForSlot(uint8_t idx)
{
  if (idx < 4)
  {
    return ring.Color(0, 150, 0);
  }
  if (idx < 8)
  {
    return ring.Color(180, 90, 0);
  }
  return ring.Color(150, 0, 0);
}

void drawIaqOnOled(float iaq, const LatestFields &fields)
{
  if (!oledReady)
  {
    return;
  }
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(OLED_X_OFFSET, OLED_Y_OFFSET);
  oled.setTextSize(1);
  oled.println("IAQ");
  oled.setTextSize(2);
  if (isnan(iaq))
  {
    oled.println("--");
  }
  else
  {
    char buf[8];
    snprintf(buf, sizeof(buf), "%3d", static_cast<int>(roundf(iaq)));
    oled.println(buf);
  }
  oled.setTextSize(1);
  if (!isnan(fields.co2))
  {
    oled.print("CO2:");
    oled.println(static_cast<int>(roundf(fields.co2)));
  }
  if (!isnan(fields.voc))
  {
    oled.print("VOC:");
    oled.println(static_cast<int>(roundf(fields.voc)));
  }
  oled.display();
}

void displayIAQ(float iaq)
{
  if (isnan(iaq))
  {
    showSolid(ring.Color(0, 0, 80));
    return;
  }
  const uint8_t active = static_cast<uint8_t>(
      roundf((clampf(iaq, 0, 100) / 100.0f) * LED_RING_COUNT));
  ring.clear();
  for (uint8_t i = 0; i < active && i < LED_RING_COUNT; ++i)
  {
    ring.setPixelColor(i, colorForSlot(i));
  }
  ring.show();
}

void wifiConnect()
{
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  showOledStatus("WiFi", "Connecting...");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000UL)
  {
    Serial.print(".");
    showSolid(ring.Color(0, 0, 40));
    delay(400);
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
    showSolid(ring.Color(0, 40, 0));
    showOledStatus("WiFi OK", WiFi.localIP().toString());
    delay(200);
    ring.clear();
    ring.show();
  }
  else
  {
    Serial.println("WiFi FAILED");
    showSolid(ring.Color(40, 0, 0));
    showOledStatus("WiFi", "Failed");
  }
}

size_t splitCsvLine(const String &line, String *cols, size_t maxCols)
{
  size_t count = 0;
  int start = 0;
  for (int i = 0; i <= line.length() && count < maxCols; ++i)
  {
    if (i == line.length() || line[i] == ',')
    {
      cols[count++] = line.substring(start, i);
      start = i + 1;
    }
  }
  return count;
}

bool parseFluxResponse(const String &payload, LatestFields &out)
{
  bool gotAny = false;
  int valueIdx = -1;
  int fieldIdx = -1;
  int pos = 0;

  while (pos < payload.length())
  {
    int next = payload.indexOf('\n', pos);
    if (next < 0)
      next = payload.length();
    String line = payload.substring(pos, next);
    pos = next + 1;
    line.trim();
    if (line.isEmpty() || line[0] == '#')
    {
      continue;
    }

    String cols[12];
    size_t count = splitCsvLine(line, cols, 12);
    if (count == 0)
    {
      continue;
    }

    bool isHeader = false;
    for (size_t i = 0; i < count; ++i)
    {
      if (cols[i] == "_field")
      {
        fieldIdx = static_cast<int>(i);
        isHeader = true;
      }
      else if (cols[i] == "_value")
      {
        valueIdx = static_cast<int>(i);
        isHeader = true;
      }
    }
    if (isHeader)
    {
      continue;
    }

    if (fieldIdx < 0 || valueIdx < 0 || fieldIdx >= static_cast<int>(count) ||
        valueIdx >= static_cast<int>(count))
    {
      continue;
    }

    const String &field = cols[fieldIdx];
    const float value = cols[valueIdx].toFloat();
    if (field == "pm2_5")
    {
      out.pm25 = value;
      gotAny = true;
    }
    else if (field == "pm10")
    {
      out.pm10 = value;
      gotAny = true;
    }
    else if (field == "co2")
    {
      out.co2 = value;
      gotAny = true;
    }
    else if (field == "voc")
    {
      out.voc = value;
      gotAny = true;
    }
    else if (field == "nox")
    {
      out.nox = value;
      gotAny = true;
    }
  }
  return gotAny;
}

bool fetchLatestFields(LatestFields &fields)
{
  String flux = "from(bucket: \"" + String(INFLUXDB_BUCKET) + "\")\n";
  flux += "  |> range(start: -6h)\n";
  flux += "  |> filter(fn: (r) => r[\"_measurement\"] == \"environment\")\n";
  flux += "  |> filter(fn: (r) => r[\"_field\"] == \"pm2_5\" or r[\"_field\"] == \"pm10\" or r[\"_field\"] == \"co2\" or r[\"_field\"] == \"voc\" or r[\"_field\"] == \"nox\")\n";
  flux += "  |> last()\n";
  flux += "  |> keep(columns: [\"_field\", \"_value\", \"_time\"])";

  HTTPClient http;
  const String url = String(INFLUXDB_URL) + "/api/v2/query?org=" + INFLUXDB_ORG;
  if (!http.begin(url))
  {
    Serial.println("HTTP begin failed");
    return false;
  }
  http.addHeader("Authorization", String("Token ") + INFLUXDB_TOKEN);
  http.addHeader("Accept", "application/csv");
  http.addHeader("Content-Type", "application/vnd.flux");

  const int code = http.POST(flux);
  String body = http.getString();
  http.end();

  if (code != HTTP_CODE_OK)
  {
    Serial.printf("Influx query failed, code=%d\n", code);
    Serial.println("---- Flux query ----");
    Serial.println(flux);
    Serial.println("---- Response ----");
    Serial.println(body);
    Serial.println("-------------------");
    return false;
  }

  const bool ok = parseFluxResponse(body, fields);
  if (!ok)
  {
    Serial.println("Influx response parsed but no target fields found:");
    Serial.println(body);
  }
  return ok;
}

void setup()
{
  Serial.begin(115200);
  while (!Serial)
  {
    delay(10);
  }

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR))
  {
    oledReady = true;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    showOledStatus("IAQ Lamp", "Booting...");
  }
  else
  {
    Serial.println("OLED init failed");
  }

  ring.begin();
  ring.setBrightness(LED_BRIGHTNESS);
  ring.clear();
  ring.show();

  wifiConnect();
}

void loop()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    showOledStatus("WiFi", "Reconnect");
    wifiConnect();
    delay(WIFI_RETRY_DELAY_MS);
    return;
  }

  const unsigned long now = millis();
  if (now - lastPoll < IAQ_REFRESH_MS)
  {
    delay(200);
    return;
  }
  lastPoll = now;

  LatestFields fields;
  if (!fetchLatestFields(fields))
  {
    Serial.println("Failed to fetch IAQ fields");
    showSolid(ring.Color(40, 0, 40));
    return;
  }

  const float iaq = computeIAQ(fields);
  Serial.printf("IAQ=%.1f (pm2.5=%.1f pm10=%.1f co2=%.0f voc=%.1f nox=%.1f)\n",
                iaq, fields.pm25, fields.pm10, fields.co2, fields.voc, fields.nox);
  displayIAQ(iaq);
}
