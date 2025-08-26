# sensirion-sen66-esp32

This project is for the ESP32 and uses PlatformIO. It is designed for collecting sensor data (with the Sensirion Sen66) and sending this data to ThingSpeak.

## Getting Started

### 1. Clone the Project

```bash
git clone https://github.com/SphaeroX/sensirion-sen66-esp32.git
cd sensirion-sen66-esp32
```

### 2. Configuration

Before compiling and uploading the project to your ESP32, you need to configure it.

1.  Copy the file [`include/example_config.h`](include/example_config.h) and rename it to `include/config.h`:

    ```bash
    cp include/example_config.h include/config.h
    ```

2.  Open the newly created file [`include/config.h`](include/config.h) and fill in the placeholders with your specific values (e.g., Wi-Fi credentials, ThingSpeak API key).

    ```c++
    // Example in include/config.h
    #define WIFI_SSID "Your_WiFi_Name"
    #define WIFI_PASSWORD "Your_WiFi_Password"
    #define THINGSPEAK_API_KEY "Your_ThingSpeak_API_Key"
    // ... further configurations
    ```

### 3. Compile and Upload

Ensure PlatformIO is installed. Then you can compile and upload the project to your ESP32:

```bash
platformio run --target upload
```

## Hardware

This project is designed to be used with the **Seeed Studio XIAO ESP32-S3** development board. This board is ideal for portable applications due to its integrated LiPo battery connector and charging circuit.

## Project Structure

*   `src/`: Main source code of the project.
*   `lib/`: Libraries used in the project (e.g., Sen66, ThingSpeakClient).
*   `include/`: Header files, including the configuration file.
*   `platformio.ini`: PlatformIO project configuration file.

## Used Libraries

*   **Sen66**: For communication with the Sen66 sensor.
*   **ThingSpeakClient**: For sending data to ThingSpeak.
*   **WiFi**: Standard ESP32 library for Wi-Fi connectivity.

## License

This project is licensed under the [MIT License](LICENSE).