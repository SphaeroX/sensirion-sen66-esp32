#pragma once

#include <Adafruit_NeoPixel.h>
#include <Arduino.h>

class LedRingTest {
 public:
  struct Config {
    uint8_t dataPin = 2;
    uint16_t ledCount = 12;
    uint8_t brightness = 64;
    uint16_t chaseDelayMs = 60;
    uint16_t holdDelayMs = 400;
    uint16_t offDelayMs = 200;
  };

  explicit LedRingTest(const Config &cfg);

  void begin();
  void tick();
  void setBrightness(uint8_t brightness);

 private:
  enum class Phase : uint8_t { Chase, Hold, OffPause };

  struct Rgb {
    uint8_t r;
    uint8_t g;
    uint8_t b;
  };

  static constexpr size_t PALETTE_SIZE = 7;
  static const Rgb PALETTE[PALETTE_SIZE];

  void advanceColor();
  uint32_t currentColor();

  Config _cfg;
  Adafruit_NeoPixel _strip;
  Phase _phase;
  uint16_t _currentPixel;
  uint8_t _colorIndex;
  unsigned long _lastStep;
  unsigned long _phaseDeadline;
};
