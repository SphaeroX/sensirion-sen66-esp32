// lib/Sen66/Sen66.h
#pragma once
#include <Arduino.h>
#include <Wire.h>

/*
  SEN66 I2C protocol notes (datasheet):
  - 7-bit I2C address for SEN6x family (SEN66): 0x6B.
  :contentReference[oaicite:0]{index=0}
  - Commands used:
      0x0021 Start Continuous Measurement (SEN6x).
  :contentReference[oaicite:1]{index=1} 0x0202 Get Data Ready (SEN6x).
  :contentReference[oaicite:2]{index=2} 0x0300 Read Measured Values (SEN66).
  Returns 27 bytes (9 * [MSB, LSB, CRC]) with PMs, RH, T, VOC, NOx, CO2.
  :contentReference[oaicite:3]{index=3} 0x0316 Read Number Concentrations
  (SEN6x). Returns PM0.5..PM10 number conc. (5 * triplets).
  :contentReference[oaicite:4]{index=4} 0xD206 Read Device Status (uint32
  flags). :contentReference[oaicite:5]{index=5}
  - Data words are 16-bit MSB-first, each followed by CRC-8 (poly 0x31, init
  0xFF). :contentReference[oaicite:6]{index=6}
*/

class Sen66 {
public:
  struct MeasuredValues {
    // Mass concentration [µg/m3]
    float pm1_0, pm2_5, pm4_0, pm10_0;
    // Ambient
    float humidity_rh;   // [%]
    float temperature_c; // [°C]
    // Indexes
    float voc_index; // unitless
    float nox_index; // unitless
    // Gas
    float co2_ppm; // [ppm]
    // Validity flags
    bool valid_pm1_0, valid_pm2_5, valid_pm4_0, valid_pm10_0;
    bool valid_humidity, valid_temperature, valid_voc, valid_nox, valid_co2;
  };

  struct NumberConcentration {
    // [particles/cm3]
    float nc0_5, nc1_0, nc2_5, nc4_0, nc10_0;
    bool valid_nc0_5, valid_nc1_0, valid_nc2_5, valid_nc4_0, valid_nc10_0;
  };

  explicit Sen66(TwoWire &w = Wire) : _wire(w) {}

  bool begin(int sda = SEN66_I2C_SDA, int scl = SEN66_I2C_SCL,
             uint32_t freq = SEN66_I2C_FREQ);
  bool startMeasurement();
  bool stopMeasurement();
  bool dataReady(bool &ready);
  bool readMeasuredValues(MeasuredValues &out);
  bool readNumberConcentration(NumberConcentration &out);
  bool readDeviceStatus(uint32_t &statusFlags);

  // Maintenance / Compensation
  bool startFanCleaning();
  bool setTemperatureOffsetParameters(int16_t offset, int16_t slope,
                                      uint16_t timeConstant);

  static constexpr uint8_t I2C_ADDR = 0x6B;

private:
  TwoWire &_wire;

  // Low-level helpers
  bool sendCommand(uint16_t cmd);
  bool readBytes(uint8_t *buf, size_t len);
  bool readTriplet(uint16_t &word);
  static uint8_t crc8(const uint8_t *data, uint16_t count);

  // Parse helpers
  static float scaleUInt16(uint16_t v, float scale, bool &valid);
  static float scaleInt16(int16_t v, float scale, bool &valid);

  bool _measurementRunning = false;
};
