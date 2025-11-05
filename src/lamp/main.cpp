#include <Arduino.h>

// Minimal "Hello World" sketch for the lamp firmware variant.
void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  Serial.println("Hello, Lamp World!");
}

void loop() {
  // Periodically repeat the message so it is visible on the serial monitor.
  Serial.println("Hello, Lamp World!");
  delay(1000);
}
