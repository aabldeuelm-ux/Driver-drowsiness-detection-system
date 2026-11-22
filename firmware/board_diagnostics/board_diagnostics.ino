/*
 * board_diagnostics.ino
 *
 * Minimal, camera-free diagnostic sketch for the observed ESP32-CAM-related
 * hardware. Observed markings only:
 *   - board: HW-297
 *   - module shield: ESP-32S
 *   - camera ribbon: GC2145
 *   - programmer: ESP32-CAM-MB with IO0 and RST buttons
 *
 * These markings are NOT proof of the internal camera pinout, module variant,
 * flash size, or PSRAM capacity. This sketch does not use the camera.
 *
 * Safety scope:
 *   - No camera init
 *   - No Wi-Fi
 *   - No SD card
 *   - No flash LED
 *   - No buzzer, motor, or other output
 *   - No pinMode(), digitalWrite(), or other external GPIO setup
 *
 * Uploading this sketch replaces whatever firmware is currently on the board.
 *
 * Official Espressif Arduino-ESP32 references used for API/setup verification:
 *   - Installing via Boards Manager:
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html
 *   - Serial.begin(115200):
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html
 *   - ESP.getChipModel(), ESP.getChipRevision(), ESP.getFlashChipSize(),
 *     ESP.getFreeHeap(), ESP.getPsramSize(), ESP.getFreePsram():
 *     Espressif Arduino-ESP32 core Esp.h/Esp.cpp and ConsoleSysInfo example:
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/api/console.html
 *   - psramFound():
 *     Espressif Console heap example:
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/api/console.html
 *   - Tools menu/PSRAM behavior:
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/guides/tools_menu.html
 *   - Upload/download-mode troubleshooting:
 *     https://docs.espressif.com/projects/arduino-esp32/en/latest/troubleshooting.html
 */

#include <Arduino.h>

static const unsigned long SERIAL_BAUD = 115200;
static const unsigned long HEARTBEAT_INTERVAL_MS = 5000;

static void printStartupReport() {
  Serial.println();
  Serial.println(F("=== ESP32 board diagnostics ==="));

  Serial.print(F("Chip model: "));
  Serial.println(ESP.getChipModel());

  Serial.print(F("Chip revision: "));
  Serial.println(static_cast<unsigned int>(ESP.getChipRevision()));

  Serial.print(F("Flash size: "));
  Serial.print(static_cast<unsigned long>(ESP.getFlashChipSize()));
  Serial.println(F(" bytes"));

  Serial.print(F("Available heap: "));
  Serial.print(static_cast<unsigned long>(ESP.getFreeHeap()));
  Serial.println(F(" bytes"));

  const bool psramDetected = psramFound();
  Serial.print(F("PSRAM detected by core: "));
  Serial.println(psramDetected ? F("yes") : F("no"));

  if (psramDetected) {
    Serial.print(F("PSRAM capacity: "));
    Serial.print(static_cast<unsigned long>(ESP.getPsramSize()));
    Serial.println(F(" bytes"));

    Serial.print(F("PSRAM free: "));
    Serial.print(static_cast<unsigned long>(ESP.getFreePsram()));
    Serial.println(F(" bytes"));
  } else {
    Serial.println(F(
      "PSRAM capacity: not visible (absent, disabled in Tools, or not initialized)"
    ));
    Serial.println(F("PSRAM free: n/a"));
  }

  Serial.println(F(
    "Camera, Wi-Fi, SD, flash LED, buzzer, motor, and external GPIO are not initialized."
  ));
  Serial.println(F("=== end startup report ==="));
  Serial.println();
}

static void printHeartbeat(unsigned long uptimeMs) {
  Serial.print(F("HEARTBEAT uptime_ms="));
  Serial.print(uptimeMs);
  Serial.print(F(" free_heap_bytes="));
  Serial.println(static_cast<unsigned long>(ESP.getFreeHeap()));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(100);
  printStartupReport();
}

void loop() {
  static unsigned long lastHeartbeatAt = 0;
  const unsigned long now = millis();

  // Wrap-safe interval check; no hardware timers or GPIO are used.
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    printHeartbeat(now);
  }

  delay(100);
}
