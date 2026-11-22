/*
 * buzzer_test.ino
 *
 * Minimal isolated LED-output verification and buzzer-output test for
 * Arduino-ESP32 3.3.12.
 *
 * Safety scope:
 *   - Serial, GPIO14, and GPIO13 only
 *   - No camera init
 *   - No Wi-Fi
 *   - No WebServer
 *   - No SD card
 *   - No onboard flash LED
 *   - No vibration motor
 *   - No other external outputs
 *
 * Assumed buzzer connection supplied by the user:
 *   ESP32 3V3 -> buzzer VCC
 *   ESP32 GND -> buzzer GND, common with the ESP32
 *   ESP32 GPIO14 -> buzzer I/O
 *
 * The module label says "low level trigger", so:
 *   GPIO14 HIGH = off
 *   GPIO14 LOW  = on
 *
 * The active-low external LED connection is:
 *   3V3 -> 1 kOhm -> LED anode -> LED cathode -> GPIO13
 *
 * So:
 *   GPIO13 HIGH = LED off
 *   GPIO13 LOW  = LED on
 *
 * IMPORTANT Arduino-ESP32 3.3.12 behavior:
 *   digitalWrite() is ignored until pinMode() has registered the pin with the
 *   GPIO peripheral manager. The previous version of this sketch wrote the
 *   off level before pinMode(OUTPUT); that write was discarded, and pinMode()
 *   left the output latch LOW. With an active-low LED this made GPIO13 appear
 *   steadily lit even though the startup log claimed it was HIGH/off.
 *
 *   This version calls pinMode(OUTPUT) first and then immediately writes the
 *   safe HIGH level. A very short boot-time glitch before setup() is still
 *   possible with the Arduino API; the required three-blink sequence below
 *   verifies that GPIO13 is genuinely being driven afterward.
 *
 * No PWM/timer peripheral is used. There is no analogWrite(), ledcWrite(),
 * tone(), Servo, or timer ISR. The 2 kHz square wave is produced only by
 * alternating digitalWrite() calls on GPIO14, timed with micros().
 *
 * Uploading this sketch replaces the firmware currently on the board.
 */

#include <Arduino.h>

static const unsigned long SERIAL_BAUD = 115200;

static const int BUZZER_PIN = 14;
static const int EXTERNAL_LED_PIN = 13;

static const uint8_t BUZZER_OFF_LEVEL = HIGH;
static const uint8_t BUZZER_ON_LEVEL = LOW;
static const uint8_t LED_OFF_LEVEL = HIGH;
static const uint8_t LED_ON_LEVEL = LOW;

static const unsigned long LED_BLINK_MS = 500UL;
static const uint8_t LED_BLINK_CYCLES = 3;
static const uint8_t LED_BLINK_STEPS = LED_BLINK_CYCLES * 2;

static const unsigned long BUZZER_START_DELAY_MS = 2000UL;
static const unsigned long DC_LOW_MS = 500UL;
static const unsigned long HIGH_OFF_MS = 1000UL;
static const unsigned long TONE_MS = 500UL;
static const unsigned long HALF_PERIOD_US = 250UL;  /* 2 kHz square wave */
static const uint8_t BUZZER_SEQUENCE_COUNT = 3;

enum class TestPhase : uint8_t {
  ledBlink,
  waitBeforeBuzzer,
  dcLow,
  highOff,
  tone,
  done,
};

static TestPhase phase = TestPhase::ledBlink;
static uint8_t ledStep = 0;
static uint8_t sequenceNumber = 0;
static unsigned long phaseStartedMs = 0;
static unsigned long lastToggleUs = 0;
static bool toneNextLevelIsLow = true;

static void setBuzzerOff()
{
  digitalWrite(BUZZER_PIN, BUZZER_OFF_LEVEL);
}

static void setLed(bool on)
{
  digitalWrite(EXTERNAL_LED_PIN, on ? LED_ON_LEVEL : LED_OFF_LEVEL);
  Serial.print(F("GPIO13 LED: "));
  Serial.println(on ? F("LOW / ON") : F("HIGH / OFF"));
}

static void applyLedBlinkStep()
{
  const bool on = (ledStep % 2 == 0);
  Serial.print(F("LED blink "));
  Serial.print((ledStep / 2) + 1);
  Serial.print(F("/3: "));
  setLed(on);
}

static void enterPhase(TestPhase nextPhase)
{
  phase = nextPhase;
  phaseStartedMs = millis();

  switch (phase) {
    case TestPhase::ledBlink:
      ledStep = 0;
      Serial.println(F("Blinking GPIO13 LED three times, 500 ms per state."));
      applyLedBlinkStep();
      break;
    case TestPhase::waitBeforeBuzzer:
      Serial.println(F("Waiting 2 s before the first buzzer test..."));
      break;
    case TestPhase::dcLow:
      sequenceNumber += 1;
      Serial.print(F("Buzzer sequence "));
      Serial.print(sequenceNumber);
      Serial.print(F("/"));
      Serial.print(BUZZER_SEQUENCE_COUNT);
      Serial.println(F(": LOW for 500 ms"));
      digitalWrite(BUZZER_PIN, BUZZER_ON_LEVEL);
      break;
    case TestPhase::highOff:
      Serial.println(F("Buzzer HIGH / off for 1 s"));
      setBuzzerOff();
      break;
    case TestPhase::tone:
      Serial.println(F("Buzzer 2 kHz square wave for 500 ms"));
      lastToggleUs = micros();
      toneNextLevelIsLow = true;
      digitalWrite(BUZZER_PIN, BUZZER_ON_LEVEL);
      break;
    case TestPhase::done:
      setBuzzerOff();
      Serial.println(F("Done. GPIO14 is HIGH/off; no further output changes."));
      break;
  }
}

void setup()
{
  Serial.begin(SERIAL_BAUD);

  /* Arduino-ESP32 3.3.12 requires pinMode before digitalWrite is effective. */
  pinMode(EXTERNAL_LED_PIN, OUTPUT);
  digitalWrite(EXTERNAL_LED_PIN, LED_OFF_LEVEL);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, BUZZER_OFF_LEVEL);

  Serial.println();
  Serial.println(F("=== LED + buzzer output test ==="));
  Serial.println(F("External LED: GPIO13, active-low, blinks then stays HIGH/off"));
  Serial.println(F("Buzzer I/O: GPIO14, low-level trigger, HIGH = off / LOW = on"));
  Serial.println(F("No camera, Wi-Fi, SD, flash LED, motor, or other outputs."));
  Serial.println(F("=== end startup ==="));
  Serial.println();

  enterPhase(TestPhase::ledBlink);
}

void loop()
{
  const unsigned long nowMs = millis();

  switch (phase) {
    case TestPhase::ledBlink:
      if (nowMs - phaseStartedMs >= LED_BLINK_MS) {
        phaseStartedMs += LED_BLINK_MS;
        ledStep += 1;

        if (ledStep >= LED_BLINK_STEPS) {
          setLed(false);
          Serial.println(F("GPIO13 held HIGH/off; starting buzzer tests."));
          enterPhase(TestPhase::waitBeforeBuzzer);
        } else {
          applyLedBlinkStep();
        }
      }
      break;

    case TestPhase::waitBeforeBuzzer:
      if (nowMs - phaseStartedMs >= BUZZER_START_DELAY_MS) {
        enterPhase(TestPhase::dcLow);
      }
      break;

    case TestPhase::dcLow:
      if (nowMs - phaseStartedMs >= DC_LOW_MS) {
        enterPhase(TestPhase::highOff);
      }
      break;

    case TestPhase::highOff:
      if (nowMs - phaseStartedMs >= HIGH_OFF_MS) {
        enterPhase(TestPhase::tone);
      }
      break;

    case TestPhase::tone: {
      const unsigned long nowUs = micros();
      if (static_cast<unsigned long>(nowUs - lastToggleUs) >= HALF_PERIOD_US) {
        lastToggleUs = nowUs;
        digitalWrite(BUZZER_PIN, toneNextLevelIsLow ? BUZZER_ON_LEVEL : BUZZER_OFF_LEVEL);
        toneNextLevelIsLow = !toneNextLevelIsLow;
      }

      if (nowMs - phaseStartedMs >= TONE_MS) {
        setBuzzerOff();
        if (sequenceNumber >= BUZZER_SEQUENCE_COUNT) {
          enterPhase(TestPhase::done);
        } else {
          enterPhase(TestPhase::dcLow);
        }
      }
      break;
    }

    case TestPhase::done:
      /* GPIO13 and GPIO14 both remain HIGH/off; nothing else is touched. */
      break;
  }
}
