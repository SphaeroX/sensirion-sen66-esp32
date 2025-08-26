// lib/ThingSpeakClient/ThingSpeakClient.cpp
#include "ThingSpeakClient.h"
#include <utility> // std::pair
#include <vector>  // std::vector

String ThingSpeakClient::buildGetPath(uint32_t /*channelId*/, const String &apiKey,
                                      const std::vector<std::pair<uint8_t, String>> &fields,
                                      const String &status)
{
    String path = "/update?api_key=" + apiKey;
    size_t count = 0;
    for (auto &kv : fields)
    {
        if (kv.first >= 1 && kv.first <= 8 && kv.second.length())
        {
            path += "&field" + String(kv.first) + "=" + kv.second;
            if (++count >= 8)
                break;
        }
    }
    if (status.length())
    {
        // minimal URL-escaping for spaces to %20
        String sEsc = status;
        sEsc.replace(" ", "%20");
        path += "&status=" + sEsc;
    }
    return path;
}

bool ThingSpeakClient::update(uint32_t channelId, const String &apiKey,
                              const std::vector<std::pair<uint8_t, String>> &fields,
                              const String &status, String *respOut)
{
    (void)channelId; // not needed for single-update API
    WiFiClient client;
    if (!client.connect(_host, _port))
        return false;

    String path = buildGetPath(channelId, apiKey, fields, status);

    String req =
        String("GET ") + path + " HTTP/1.1\r\n" +
        "Host: " + _host + "\r\n" +
        "User-Agent: XIAO-ESP32S3-SEN66\r\n" +
        "Connection: close\r\n\r\n";

    client.print(req);

    unsigned long start = millis();
    while (!client.available())
    {
        if (millis() - start > 4000)
        {
            client.stop();
            return false;
        }
        delay(10);
    }

    String response;
    while (client.available())
    {
        response += client.readString();
    }
    client.stop();

    if (respOut)
        *respOut = response;

    // ThingSpeak returns HTTP 200 and a body with the entry ID (>0) or 0 on failure
    return response.indexOf(" 200 ") > 0;
}
