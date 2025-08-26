// lib/ThingSpeakClient/ThingSpeakClient.h
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <utility> // for std::pair
#include <vector>  // for std::vector

class ThingSpeakClient
{
public:
    ThingSpeakClient(const char *host = "api.thingspeak.com", uint16_t port = 80)
        : _host(host), _port(port) {}

    // fields: vector of (fieldNumber 1..8, value as string)
    bool update(uint32_t channelId, const String &apiKey,
                const std::vector<std::pair<uint8_t, String>> &fields,
                const String &status = "", String *respOut = nullptr);

private:
    const char *_host;
    uint16_t _port;

    String buildGetPath(uint32_t channelId, const String &apiKey,
                        const std::vector<std::pair<uint8_t, String>> &fields,
                        const String &status);
};
