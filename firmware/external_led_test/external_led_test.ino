/*
 * external_led_test.ino
 *
 * Minimal, nonblocking external red LED test for the prototype.
 *
 * Safety scope:
 *   - No camera init
 *   - No Wi-Fi
 *   - No WebServer
 *   - No SD card
 *   - No onboard flash LED
 *   - No buzzer
 *   - No vibration motor
 *   - No other external outputs
 *
 * LED connection used by this sketch (current sinking):
 *   3V3 -> 1 kΩ resistor -> LED anode -> LED cathode -> GPIO13
 *
 * With this connection:
 *   - GPIO HIGH = LED OFF
 *   - GPIO LOW  = LED ON
 *
 * The output level is written before pinMode(OUTPUT) so the LED remains off
 * during the input-to-output transition. All timing uses millis(); loop()
 * never calls delay().
 *
 * Uploading this sketch replaces the firmware currently on the board.
 */

#include <Arduino.h>

static const unsigned long SERIAL_BAUD = 115200;
static const int EXTERNAL_LED_PIN = 13;
static const uint8_t LED_OFF_LEVEL = HIGH;
static const uint8_t LED_ON_LEVEL = LOW;
static const unsigned long BLINK_INTERVAL_MS = 500UL;

static bool ledIsOn = false;
static unsigned long lastToggleMs = 0;

static void setLed(bool on)
{
  digitalWrite(EXTERNAL_LED_PIN, on ? LED_ON_LEVEL : LED_OFF_LEVEL);
  ledIsOn = on;
  Serial.print(F("External LED: "));
  Serial.println(on ? F("ON") : F("OFF"));
}

void setup()
{
  Serial.begin(SERIAL_BAUD);

  /* Set the off level first, then expose the pin as an output. */
  digitalWrite(EXTERNAL_LED_PIN, LED_OFF_LEVEL);
  pinMode(EXTERNAL_LED_PIN, OUTPUT);

  Serial.println();
  Serial.println(F("=== External LED test ==="));
  Serial.print(F("LED pin: GPIO"));
  Serial.println(EXTERNAL_LED_PIN);
  Serial.println(F("Wiring: 3V3 -> 1 kΩ -> LED anode -> LED cathode -> GPIO13"));
  Serial.println(F("Logic: HIGH = OFF, LOW = ON"));
  Serial.println(F("No camera, Wi-Fi, buzzer, motor, SD, or flash LED is initialized."));
  Serial.println(F("LED starts OFF; blink starts after the first interval."));
  Serial.println(F("=== end startup ==="));
  Serial.println();

  lastToggleMs = millis();
}

void loop()
{
  const unsigned long nowMs = millis();
  if (nowMs - lastToggleMs >= BLINK_INTERVAL_MS) {
    lastToggleMs = nowMs;
    setLed(!ledIsOn);
  }
}
