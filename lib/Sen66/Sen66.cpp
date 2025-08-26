// lib/Sen66/Sen66.cpp
#include "Sen66.h"

// ===== CRC-8 (poly 0x31, init 0xFF) per datasheet =====
uint8_t Sen66::crc8(const uint8_t *data, uint16_t count)
{
    uint8_t crc = 0xFF; // init
    for (uint16_t i = 0; i < count; ++i)
    {
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; ++b)
        {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

bool Sen66::begin(int sda, int scl, uint32_t freq)
{
    _wire.begin();
    _wire.setClock(freq);
    delay(5);
    return true;
}

bool Sen66::sendCommand(uint16_t cmd)
{
    _wire.beginTransmission(I2C_ADDR);
    _wire.write((uint8_t)(cmd >> 8));
    _wire.write((uint8_t)(cmd & 0xFF));
    uint8_t err = _wire.endTransmission();
    return err == 0;
}

bool Sen66::readBytes(uint8_t *buf, size_t len)
{
    size_t readLen = _wire.requestFrom((int)I2C_ADDR, (int)len);
    if (readLen != len)
        return false;
    for (size_t i = 0; i < len; ++i)
        buf[i] = (uint8_t)_wire.read();
    return true;
}

bool Sen66::readTriplet(uint16_t &word)
{
    uint8_t b[3];
    if (!readBytes(b, 3))
        return false;
    // Verify CRC over the two data bytes
    if (crc8(b, 2) != b[2])
        return false;
    word = ((uint16_t)b[0] << 8) | b[1];
    return true;
}

bool Sen66::startMeasurement()
{
    if (!sendCommand(0x0021))
        return false; // Start Continuous Measurement (SEN6x)
    delay(50);        // execution time (ms)
    return true;
}

bool Sen66::dataReady(bool &ready)
{
    if (!sendCommand(0x0202))
        return false; // Get Data Ready (SEN6x)
    delay(20);
    // Expect 3 bytes: padding(0x00), ready(0x00/0x01), CRC
    uint8_t b[3];
    if (!readBytes(b, 3))
        return false;
    if (crc8(b, 2) != b[2])
        return false;
    ready = (b[1] == 0x01);
    return true;
}

float Sen66::scaleUInt16(uint16_t v, float scale, bool &valid)
{
    if (v == 0xFFFF)
    {
        valid = false;
        return NAN;
    }
    valid = true;
    return (float)v / scale;
}

float Sen66::scaleInt16(int16_t v, float scale, bool &valid)
{
    if (v == 0x7FFF)
    {
        valid = false;
        return NAN;
    }
    valid = true;
    return (float)v / scale;
}

bool Sen66::readMeasuredValues(MeasuredValues &out)
{
    if (!sendCommand(0x0300))
        return false; // Read Measured Values (SEN66)
    delay(20);

    // 9 words, each with CRC => 9 * 3 = 27 bytes
    uint16_t w;

    // PM1.0 [µg/m3] (scale x10)
    if (!readTriplet(w))
        return false;
    out.pm1_0 = scaleUInt16(w, 10.0f, out.valid_pm1_0);

    // PM2.5
    if (!readTriplet(w))
        return false;
    out.pm2_5 = scaleUInt16(w, 10.0f, out.valid_pm2_5);

    // PM4.0
    if (!readTriplet(w))
        return false;
    out.pm4_0 = scaleUInt16(w, 10.0f, out.valid_pm4_0);

    // PM10.0
    if (!readTriplet(w))
        return false;
    out.pm10_0 = scaleUInt16(w, 10.0f, out.valid_pm10_0);

    // RH int16 (scale x100)
    if (!readTriplet(w))
        return false;
    out.humidity_rh = scaleInt16((int16_t)w, 100.0f, out.valid_humidity);

    // T int16 (scale x200)
    if (!readTriplet(w))
        return false;
    out.temperature_c = scaleInt16((int16_t)w, 200.0f, out.valid_temperature);

    // VOC index int16 (scale x10)
    if (!readTriplet(w))
        return false;
    out.voc_index = scaleInt16((int16_t)w, 10.0f, out.valid_voc);

    // NOx index int16 (scale x10)
    if (!readTriplet(w))
        return false;
    out.nox_index = scaleInt16((int16_t)w, 10.0f, out.valid_nox);

    // CO2 ppm (uint16, direct)
    if (!readTriplet(w))
        return false;
    if (w == 0xFFFF)
    {
        out.valid_co2 = false;
        out.co2_ppm = NAN;
    }
    else
    {
        out.valid_co2 = true;
        out.co2_ppm = (float)w;
    }

    return true;
}

bool Sen66::readNumberConcentration(NumberConcentration &out)
{
    if (!sendCommand(0x0316))
        return false; // Read Number Concentration (SEN6x)
    delay(20);

    uint16_t w;
    // PM0.5 #/cm3 (scale x10)
    if (!readTriplet(w))
        return false;
    out.nc0_5 = scaleUInt16(w, 10.0f, out.valid_nc0_5);

    // PM1.0
    if (!readTriplet(w))
        return false;
    out.nc1_0 = scaleUInt16(w, 10.0f, out.valid_nc1_0);

    // PM2.5
    if (!readTriplet(w))
        return false;
    out.nc2_5 = scaleUInt16(w, 10.0f, out.valid_nc2_5);

    // PM4.0
    if (!readTriplet(w))
        return false;
    out.nc4_0 = scaleUInt16(w, 10.0f, out.valid_nc4_0);

    // PM10.0
    if (!readTriplet(w))
        return false;
    out.nc10_0 = scaleUInt16(w, 10.0f, out.valid_nc10_0);

    return true;
}

bool Sen66::readDeviceStatus(uint32_t &statusFlags)
{
    if (!sendCommand(0xD206))
        return false; // Read Device Status (SEN6x)
    delay(20);

    // Expect 6 bytes: [MSB word][CRC][LSB word][CRC]
    uint8_t b[6];
    if (!readBytes(b, 6))
        return false;

    if (crc8(b + 0, 2) != b[2])
        return false;
    if (crc8(b + 3, 2) != b[5])
        return false;

    statusFlags = ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16) | ((uint32_t)b[3] << 8) | (uint32_t)b[4];
    return true;
}
