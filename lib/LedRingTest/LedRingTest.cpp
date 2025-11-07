#include "LedRingTest.h"

const LedRingTest::Rgb LedRingTest::PALETTE[LedRingTest::PALETTE_SIZE] = {
    {255, 32, 32},  {32, 255, 80},  {32, 64, 255}, {255, 180, 32},
    {255, 32, 180}, {32, 255, 255}, {255, 255, 255}};

LedRingTest::LedRingTest(const Config &cfg)
    : _cfg(cfg),
      _strip(cfg.ledCount, cfg.dataPin, NEO_GRB + NEO_KHZ800),
      _phase(Phase::Chase),
      _currentPixel(0),
      _colorIndex(0),
      _lastStep(0),
      _phaseDeadline(0) {}

void LedRingTest::begin() {
  _strip.begin();
  _strip.setBrightness(_cfg.brightness);
  _strip.show();
  _lastStep = millis();
  _phaseDeadline = _lastStep;
}

void LedRingTest::setBrightness(uint8_t brightness) {
  _cfg.brightness = brightness;
  _strip.setBrightness(brightness);
  _strip.show();
}

void LedRingTest::tick() {
  if (_cfg.ledCount == 0) {
    return;
  }

  const unsigned long now = millis();

  switch (_phase) {
  case Phase::Chase:
    if (now - _lastStep < _cfg.chaseDelayMs) {
      return;
    }
    _lastStep = now;
    _strip.setPixelColor(_currentPixel, currentColor());
    _strip.show();
    _currentPixel++;
    if (_currentPixel >= _cfg.ledCount) {
      _phase = Phase::Hold;
      _phaseDeadline = now;
    }
    break;

  case Phase::Hold:
    if (now - _phaseDeadline < _cfg.holdDelayMs) {
      return;
    }
    _strip.clear();
    _strip.show();
    _phase = Phase::OffPause;
    _phaseDeadline = now;
    break;

  case Phase::OffPause:
    if (now - _phaseDeadline < _cfg.offDelayMs) {
      return;
    }
    advanceColor();
    _phase = Phase::Chase;
    _currentPixel = 0;
    _lastStep = now;
    break;
  }
}

void LedRingTest::advanceColor() {
  _colorIndex = (_colorIndex + 1) % PALETTE_SIZE;
}

uint32_t LedRingTest::currentColor() {
  const Rgb &rgb = PALETTE[_colorIndex];
  return _strip.Color(rgb.r, rgb.g, rgb.b);
}
