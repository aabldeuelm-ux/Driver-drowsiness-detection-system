/*
 * ESP32 hardware-alert controller for the drowsiness admin app.
 *
 * This sketch is deliberately camera-free. It does not initialize a camera,
 * request PIXFORMAT_JPEG, convert frames, allocate PSRAM, record, or use SD.
 * Its only job is to accept the same one-shot alert GETs used by the admin and
 * drive the already-tested external outputs:
 *
 *   LED:    3V3 -> 1 kOhm -> LED anode -> LED cathode -> GPIO13
 *            GPIO13 LOW = ON, HIGH = OFF (active low)
 *   Buzzer: VCC -> 3V3, GND common, I/O -> GPIO14
 *            GPIO14 LOW = ON, HIGH = OFF (active low)
 *
 * GPIO14 is the low-level-trigger module input verified in the isolated bench
 * test. The buzzer remains powered at 3.3 V exactly as before. Its 1-second
 * alert uses a nonblocking 2 kHz, 50% duty LEDC square wave (the 3.x
 * ledcAttach/ledcWrite/ledcDetach API), then GPIO14 is returned to HIGH/off.
 * No tone(), timer ISR, motor, flash LED, or SD output is used.
 *
 * pinMode(OUTPUT) is called before digitalWrite() on both pins. Both pins are
 * HIGH/off at boot and no pulse is emitted automatically. Each request starts
 * one bounded 1000 ms alert with automatic HIGH/off shutoff driven by millis()
 * in loop(); no delay() is used in the alert path. LEDC resources are detached
 * on every buzzer shutoff, including a repeated request or a failed attach.
 *
 * Wi-Fi credentials stay in the local secrets.h beside this sketch. They are
 * never printed or written into source, serial output, or documentation.
 */

#include <Arduino.h>
#include <string.h>
#include <WiFi.h>
#include <WebServer.h>
#include "secrets.h"

static const uint32_t SERIAL_BAUD = 115200;
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000UL;

static const int EXTERNAL_LED_PIN = 13;
static const int BUZZER_PIN = 14;
static const uint8_t OUTPUT_OFF_LEVEL = HIGH;
static const uint8_t OUTPUT_ON_LEVEL = LOW;
static const unsigned long OUTPUT_TEST_ACTIVE_MS = 1000UL;
static const uint32_t BUZZER_PWM_FREQUENCY_HZ = 2000UL;
static const uint8_t BUZZER_PWM_RESOLUTION_BITS = 8;

/* Change this whenever endpoints or output behavior change. */
static const char FIRMWARE_BUILD_ID[] = "alert_controller-2026-11-22-2khz-v2";

struct OutputPulse
{
  bool active;
  bool pwmAttached;
  unsigned long startedMs;
  unsigned long durationMs;
};

static WebServer server(80);
static OutputPulse ledPulse = {false, false, 0, 0};
static OutputPulse buzzerPulse = {false, false, 0, 0};
static int wifiSleepEnabledAfterSetup = -1;

static const char PAGE_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ESP32 alert controller</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 42rem; }
    button { font-size: 1rem; padding: 0.55rem 0.9rem; cursor: pointer; }
    #status { margin-top: 1rem; color: #333; }
  </style>
</head>
<body>
  <h1>ESP32 alert controller</h1>
  <p>Build: <strong id="build">__BUILD_ID__</strong></p>
  <p>Camera-free alert device. GPIO13 LED uses a 1000 ms LOW pulse. GPIO14 buzzer uses a nonblocking 2 kHz square wave for 1000 ms. Both return HIGH/off automatically.</p>
  <p>
    <button id="led" type="button">Test LED (GPIO13)</button>
    <button id="buzzer" type="button">Test buzzer (GPIO14)</button>
  </p>
  <p id="status">Ready.</p>
  <script>
    const status = document.getElementById('status');
    function test(path, label) {
      status.textContent = 'Requesting ' + label + '...';
      fetch(path, {cache: 'no-store', credentials: 'omit'})
        .then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function(body) { status.textContent = label + ': ' + body; })
        .catch(function(error) { status.textContent = label + ' failed: ' + error.message; });
    }
    document.getElementById('led').addEventListener('click', function() {
      test('/led_test', 'LED test');
    });
    document.getElementById('buzzer').addEventListener('click', function() {
      test('/buzzer_test', 'Buzzer test');
    });
  </script>
</body>
</html>
)rawliteral";

static void addCorsHeaders()
{
  server.sendHeader(F("X-Firmware-Build"), String(FIRMWARE_BUILD_ID));
  server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
  server.sendHeader(F("Access-Control-Allow-Methods"), F("GET, OPTIONS"));
  server.sendHeader(F("Access-Control-Allow-Headers"), F("Content-Type"));
  server.sendHeader(F("Access-Control-Allow-Private-Network"), F("true"));
}

static void sendText(int code, const String &message)
{
  if (!server.client().connected()) {
    Serial.println(F("Client disconnected; skipping text response."));
    return;
  }
  server.sendHeader(F("Cache-Control"), F("no-store"));
  addCorsHeaders();
  server.send(code, "text/plain; charset=utf-8", message.c_str());
}

static void handleOptions()
{
  addCorsHeaders();
  server.sendHeader(F("Cache-Control"), F("no-store"));
  server.send(204, "text/plain", "");
}

static void startLedPulse()
{
  ledPulse.active = true;
  ledPulse.startedMs = millis();
  ledPulse.durationMs = OUTPUT_TEST_ACTIVE_MS;
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_ON_LEVEL);

  Serial.print(F("LED test started: GPIO"));
  Serial.print(EXTERNAL_LED_PIN);
  Serial.print(F(" LOW for "));
  Serial.print(OUTPUT_TEST_ACTIVE_MS);
  Serial.println(F(" ms; automatic HIGH/off pending."));
}

static void updateLedPulse()
{
  if (!ledPulse.active) return;
  if (millis() - ledPulse.startedMs < ledPulse.durationMs) return;

  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  ledPulse.active = false;
  Serial.println(F("LED test auto-off: GPIO13 returned HIGH/off."));
}

/** Always leaves GPIO14 as a normal HIGH/off output with no LEDC channel held. */
static void restoreBuzzerOff(bool logShutoff)
{
  if (buzzerPulse.pwmAttached) {
    // Force the active-low buzzer off while PWM still owns the pin, then
    // release the auto-assigned LEDC channel before returning to GPIO control.
    ledcWrite(BUZZER_PIN, 1UL << BUZZER_PWM_RESOLUTION_BITS);
    if (!ledcDetach(BUZZER_PIN)) {
      Serial.println(F("Warning: GPIO14 LEDC detach failed; GPIO was restored."));
    }
    buzzerPulse.pwmAttached = false;
  }

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, OUTPUT_OFF_LEVEL);
  buzzerPulse.active = false;

  if (logShutoff) {
    Serial.println(F("Buzzer test auto-off: GPIO14 returned HIGH/off; PWM detached."));
  }
}

static bool startBuzzerPulse()
{
  // A repeated request supersedes the old pulse cleanly; no stale PWM channel
  // is left behind and no retry is queued by firmware.
  restoreBuzzerOff(false);

  if (!ledcAttach(BUZZER_PIN, BUZZER_PWM_FREQUENCY_HZ, BUZZER_PWM_RESOLUTION_BITS)) {
    Serial.println(F("Buzzer test failed: LEDC attach was rejected."));
    restoreBuzzerOff(false);
    return false;
  }
  buzzerPulse.pwmAttached = true;

  const uint32_t duty = 1UL << (BUZZER_PWM_RESOLUTION_BITS - 1U);  // 50%
  if (!ledcWrite(BUZZER_PIN, duty)) {
    Serial.println(F("Buzzer test failed: LEDC duty write was rejected."));
    restoreBuzzerOff(false);
    return false;
  }

  buzzerPulse.active = true;
  buzzerPulse.startedMs = millis();
  buzzerPulse.durationMs = OUTPUT_TEST_ACTIVE_MS;

  Serial.print(F("Buzzer test started: GPIO"));
  Serial.print(BUZZER_PIN);
  Serial.print(F(" "));
  Serial.print(BUZZER_PWM_FREQUENCY_HZ);
  Serial.print(F(" Hz square wave for "));
  Serial.print(OUTPUT_TEST_ACTIVE_MS);
  Serial.println(F(" ms; automatic HIGH/off and PWM detach pending."));
  return true;
}

static void updateBuzzerPulse()
{
  if (!buzzerPulse.active) return;
  if (millis() - buzzerPulse.startedMs < buzzerPulse.durationMs) return;
  restoreBuzzerOff(true);
}

static void updateOutputPulses()
{
  updateLedPulse();
  updateBuzzerPulse();
}

static void handleLedTest()
{
  startLedPulse();
  sendText(200, "LED test started: GPIO13 LOW for 1000 ms, then HIGH/off automatically.");
}

static void handleBuzzerTest()
{
  if (!startBuzzerPulse()) {
    sendText(503, "Buzzer test failed: PWM could not be started. GPIO14 is HIGH/off.");
    return;
  }
  sendText(200, "Buzzer test started: GPIO14 2000 Hz square wave for 1000 ms, then HIGH/off automatically.");
}

static void handleVersion()
{
  char body[200];
  snprintf(body, sizeof(body),
           "build=%s; role=alert-controller; pulse_ms=%lu; buzzer_hz=%lu; camera=none; wifi_sleep_enabled=%d",
           FIRMWARE_BUILD_ID, OUTPUT_TEST_ACTIVE_MS, BUZZER_PWM_FREQUENCY_HZ,
           wifiSleepEnabledAfterSetup);
  sendText(200, body);
}

static void handleRoot()
{
  String html;
  html.reserve(strlen_P(PAGE_HTML) + 64U);
  html += PAGE_HTML;
  html.replace("__BUILD_ID__", FIRMWARE_BUILD_ID);

  server.sendHeader(F("Cache-Control"), F("no-store"));
  addCorsHeaders();
  server.send(200, "text/html; charset=utf-8", html.c_str());
}

static void handleNotFound()
{
  sendText(404, "Not found. Use /version, /led_test, or /buzzer_test.");
}

static bool connectToWiFi()
{
  if (strcmp(CAMERA_PREVIEW_WIFI_SSID, "YOUR_2_4GHZ_WIFI_SSID") == 0 ||
      strcmp(CAMERA_PREVIEW_WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0) {
    Serial.println(F("Wi-Fi setup error: secrets.h still contains placeholder values."));
    Serial.println(F("Edit firmware/alert_controller/secrets.h, then recompile and upload."));
    return false;
  }

  Serial.println(F("=== Wi-Fi connection ==="));
  Serial.println(F("Connecting to configured 2.4 GHz network (credentials not printed)..."));
  Serial.print(F("Timeout: "));
  Serial.print(WIFI_CONNECT_TIMEOUT_MS);
  Serial.println(F(" ms"));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(CAMERA_PREVIEW_WIFI_SSID, CAMERA_PREVIEW_WIFI_PASSWORD);

  const unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(F("."));
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.print(F("Wi-Fi connection TIMEOUT after "));
    Serial.print(WIFI_CONNECT_TIMEOUT_MS);
    Serial.println(F(" ms."));
    Serial.print(F("Final Wi-Fi status code: "));
    Serial.println(static_cast<int>(WiFi.status()));
    WiFi.disconnect();
    WiFi.mode(WIFI_OFF);
    return false;
  }

  Serial.println(F("Wi-Fi connected."));
  Serial.print(F("IP address: "));
  Serial.println(WiFi.localIP());
  Serial.print(F("Signal (RSSI): "));
  Serial.print(WiFi.RSSI());
  Serial.println(F(" dBm"));

  Serial.print(F("Wi-Fi sleep mode before performance change (numeric): "));
  Serial.println(static_cast<int>(WiFi.getSleep()));
  const bool sleepDisabled = WiFi.setSleep(false);
  wifiSleepEnabledAfterSetup = static_cast<int>(WiFi.getSleep());
  Serial.print(F("Wi-Fi sleep disable request result: "));
  Serial.println(sleepDisabled ? F("ok") : F("failed"));
  Serial.print(F("Wi-Fi sleep mode after performance change (numeric; 0=disabled): "));
  Serial.println(wifiSleepEnabledAfterSetup);
  Serial.println(F("=== end Wi-Fi connection ==="));
  return true;
}

void setup()
{
  Serial.begin(SERIAL_BAUD);
  delay(100);

  Serial.println(F("=== Alert controller startup ==="));
  Serial.print(F("Firmware build: "));
  Serial.println(FIRMWARE_BUILD_ID);

  /* Correct order proven by the isolated hardware tests: output mode first. */
  pinMode(EXTERNAL_LED_PIN, OUTPUT);
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, OUTPUT_OFF_LEVEL);
  ledPulse = OutputPulse{false, false, 0, 0};
  buzzerPulse = OutputPulse{false, false, 0, 0};
  Serial.println(F("Outputs initialized HIGH/off; no startup pulse."));

  if (!connectToWiFi()) {
    Serial.println(F("=== Alert controller startup ABORTED ==="));
    return;
  }

  server.on(F("/"), HTTP_GET, handleRoot);
  server.on(F("/version"), HTTP_GET, handleVersion);
  server.on(F("/version"), HTTP_OPTIONS, handleOptions);
  server.on(F("/led_test"), HTTP_GET, handleLedTest);
  server.on(F("/led_test"), HTTP_OPTIONS, handleOptions);
  server.on(F("/buzzer_test"), HTTP_GET, handleBuzzerTest);
  server.on(F("/buzzer_test"), HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
  server.begin();

  Serial.println(F("=== Alert server ready ==="));
  Serial.print(F("Firmware build: "));
  Serial.println(FIRMWARE_BUILD_ID);
  Serial.print(F("Version endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/version"));
  Serial.print(F("LED test endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/led_test"));
  Serial.print(F("Buzzer test endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/buzzer_test"));
  Serial.println(F("=== end alert server ready ==="));
}

void loop()
{
  server.handleClient();
  updateOutputPulses();
  yield();
}
