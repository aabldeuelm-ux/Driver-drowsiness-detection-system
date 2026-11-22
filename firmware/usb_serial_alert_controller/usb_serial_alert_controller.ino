/*
 * USB-serial alert controller for the portable drowsiness demo.
 *
 * One-time firmware upload goes on the ESP32. After that, another laptop only
 * needs the deployed HTTPS web app, desktop Chrome/Edge, the external webcam,
 * and a USB cable to this board. No Wi-Fi, camera, local server, or credentials
 * are used by this sketch.
 *
 * Wiring is unchanged:
 *   LED:    3V3 -> 1 kOhm -> LED anode -> LED cathode -> GPIO13
 *            GPIO13 LOW = ON, HIGH = OFF (active low)
 *   Buzzer: VCC -> 3V3, GND common, I/O -> GPIO14
 *            GPIO14 LOW = ON, HIGH = OFF (active low)
 *
 * GPIO13 uses a bounded 1000 ms active-low pulse and is never touched by
 * escalation. GPIO14 uses a nonblocking 2 kHz, 50% duty LEDC square wave for
 * one-shot alerts. Escalation repeats that same tone 500 ms ON / 500 ms OFF
 * only while the browser renews a short lease. Both return HIGH/off
 * automatically via millis() in loop(); there is no delay() in any alert path.
 *
 * Protocol: ASCII, 115200 baud, one frame per newline, version DDD1.
 *   Host -> device: DDD1|COMMAND|ID[|ARG]
 *     HELLO|id                    handshake / device identification
 *     TEST|id|LED                 LED only
 *     TEST|id|BUZZER              buzzer only
 *     TEST|id|ALL                 LED and buzzer together
 *     ESCALATE|id|START           begin leased 500/500 ms buzzer pattern
 *     ESCALATE|id|RENEW           extend the active lease
 *     ESCALATE|id|STOP            silence immediately
 *   Device -> host: DDD1|ACK|ID|COMMAND[|field=value...]
 *                   DDD1|NACK|ID|REASON
 *
 * IDs are 1-40 chars from [A-Za-z0-9._:-]. The last 16 IDs are remembered so a
 * duplicated command cannot retrigger an output. Frames are bounded to 128
 * printable characters; malformed, non-versioned, and unknown frames never
 * touch the outputs. No command is queued or replayed by this firmware.
 *
 * The HELLO ACK advertises features=escalation. A RENEW for an inactive lease
 * is rejected with NACK|NOT_ACTIVE; it never starts a new pattern. If renewals
 * stop for any reason, the 1200 ms watchdog expires and loop() silences the
 * buzzer without waiting for another command.
 */

#include <Arduino.h>

static const char PROTOCOL_VERSION[] = "DDD1";
static const char DEVICE_ID[] = "usb-serial-alert-controller";
static const char FIRMWARE_BUILD_ID[] = "usb-serial-alert-controller-2026-11-22-v3";

static const int EXTERNAL_LED_PIN = 13;
static const int BUZZER_PIN = 14;

static const uint8_t OUTPUT_OFF_LEVEL = HIGH;
static const uint8_t OUTPUT_ON_LEVEL = LOW;
static const unsigned long ALERT_ACTIVE_MS = 1000UL;
static const uint32_t BUZZER_FREQUENCY_HZ = 2000UL;
static const uint8_t BUZZER_RESOLUTION_BITS = 8;
static const uint32_t BUZZER_DUTY_OFF = 1UL << BUZZER_RESOLUTION_BITS;
static const uint32_t BUZZER_DUTY_ON = 1UL << (BUZZER_RESOLUTION_BITS - 1U);

static const unsigned long ESCALATION_HALF_CYCLE_MS = 500UL;
static const unsigned long ESCALATION_LEASE_MS = 1200UL;

static const unsigned long SERIAL_BAUD = 115200UL;
static const size_t MAX_LINE_LENGTH = 128U;
static const size_t MAX_ID_LENGTH = 40U;
static const size_t MAX_NAME_LENGTH = 23U;
static const size_t MAX_ARG_LENGTH = 15U;
static const uint8_t DUPLICATE_CACHE_SIZE = 16U;

struct OutputPulse
{
  bool active;
  bool pwmAttached;
  unsigned long startedMs;
  unsigned long durationMs;
};

struct EscalationState
{
  bool active;
  bool pwmAttached;
  bool toneOn;
  unsigned long halfStartedMs;
  unsigned long leaseExpiresMs;
};

static OutputPulse ledPulse = {false, false, 0, 0};
static OutputPulse buzzerPulse = {false, false, 0, 0};
static EscalationState escalation = {false, false, false, 0, 0};

static char lineBuffer[MAX_LINE_LENGTH + 1U];
static size_t lineLength = 0U;

static char rememberedIds[DUPLICATE_CACHE_SIZE][MAX_ID_LENGTH + 1U];
static uint8_t rememberedCursor = 0U;

static bool isValidId(const char *value)
{
  const size_t length = strlen(value);
  if (length == 0U || length > MAX_ID_LENGTH) return false;

  for (size_t index = 0U; index < length; index += 1U) {
    const char ch = value[index];
    const bool alphaNumeric = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                              (ch >= '0' && ch <= '9');
    if (!alphaNumeric && ch != '.' && ch != '_' && ch != ':' && ch != '-') return false;
  }
  return true;
}

static bool isValidName(const char *value)
{
  const size_t length = strlen(value);
  if (length == 0U || length > MAX_NAME_LENGTH) return false;
  for (size_t index = 0U; index < length; index += 1U) {
    const char ch = value[index];
    if (!(ch >= 'A' && ch <= 'Z') && !(ch >= '0' && ch <= '9') && ch != '_') return false;
  }
  return true;
}

static bool copyBounded(char *destination, size_t destinationSize, const char *source)
{
  const size_t length = strlen(source);
  if (length == 0U || length >= destinationSize) return false;
  memcpy(destination, source, length + 1U);
  return true;
}

/** Preserves empty fields, unlike strtok(), so a missing ID is detectable. */
static uint8_t splitFields(char *line, char *fields[], uint8_t maxFields)
{
  uint8_t count = 0U;
  fields[count++] = line;

  for (char *cursor = line; *cursor != '\0'; cursor += 1U) {
    if (*cursor != '|') continue;
    if (count >= maxFields) return 0U;
    *cursor = '\0';
    fields[count++] = cursor + 1U;
  }
  return count;
}

static void sendNack(const char *id, const char *reason)
{
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("|NACK|"));
  Serial.print(id);
  Serial.print('|');
  Serial.println(reason);
}

static void sendAck(const char *id, const char *command, const char *extra)
{
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("|ACK|"));
  Serial.print(id);
  Serial.print('|');
  Serial.print(command);
  if (extra != nullptr && extra[0] != '\0') {
    Serial.print('|');
    Serial.print(extra);
  }
  Serial.println();
}

/**
 * HELLO fields are written directly instead of through a bounded scratch
 * buffer. The full field list is longer than 128 bytes; using snprintf() into
 * a 128-byte buffer truncated `features=escalation` to `features=escal`, so the
 * browser correctly refused to enable escalation. This emits the exact token.
 */
static void sendHelloAck(const char *id)
{
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("|ACK|"));
  Serial.print(id);
  Serial.print(F("|HELLO|device="));
  Serial.print(DEVICE_ID);
  Serial.print(F("|build="));
  Serial.print(FIRMWARE_BUILD_ID);
  Serial.print(F("|protocol=1|outputs=led,buzzer|features=escalation"));
  Serial.println();
}

/** Returns false only for a repeated ID; the cache is bounded and never grows. */
static bool rememberId(const char *id)
{
  for (uint8_t index = 0U; index < DUPLICATE_CACHE_SIZE; index += 1U) {
    if (strcmp(rememberedIds[index], id) == 0) return false;
  }

  strncpy(rememberedIds[rememberedCursor], id, MAX_ID_LENGTH);
  rememberedIds[rememberedCursor][MAX_ID_LENGTH] = '\0';
  rememberedCursor = static_cast<uint8_t>((rememberedCursor + 1U) % DUPLICATE_CACHE_SIZE);
  return true;
}

static void startLedPulse()
{
  // A repeated TEST with a new ID supersedes the old bounded pulse.
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  ledPulse.active = true;
  ledPulse.startedMs = millis();
  ledPulse.durationMs = ALERT_ACTIVE_MS;
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_ON_LEVEL);
}

static void updateLedPulse()
{
  if (!ledPulse.active) return;
  if (millis() - ledPulse.startedMs < ledPulse.durationMs) return;
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  ledPulse.active = false;
}

/** Always leaves GPIO14 as a normal HIGH/off output with no LEDC channel held. */
static void restoreBuzzerOff()
{
  if (buzzerPulse.pwmAttached || escalation.pwmAttached) {
    ledcWrite(BUZZER_PIN, BUZZER_DUTY_OFF);  // force active-low off
    ledcDetach(BUZZER_PIN);
    buzzerPulse.pwmAttached = false;
    escalation.pwmAttached = false;
  }
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, OUTPUT_OFF_LEVEL);
  buzzerPulse.active = false;
  escalation.active = false;
  escalation.toneOn = false;
}

static bool startBuzzerPulse()
{
  restoreBuzzerOff();

  if (!ledcAttach(BUZZER_PIN, BUZZER_FREQUENCY_HZ, BUZZER_RESOLUTION_BITS)) {
    restoreBuzzerOff();
    return false;
  }
  buzzerPulse.pwmAttached = true;

  if (!ledcWrite(BUZZER_PIN, BUZZER_DUTY_ON)) {
    restoreBuzzerOff();
    return false;
  }

  buzzerPulse.active = true;
  buzzerPulse.startedMs = millis();
  buzzerPulse.durationMs = ALERT_ACTIVE_MS;
  return true;
}

static void updateBuzzerPulse()
{
  if (!buzzerPulse.active) return;
  if (millis() - buzzerPulse.startedMs < buzzerPulse.durationMs) return;
  restoreBuzzerOff();
}

static bool startEscalation()
{
  // Only GPIO14 is used. GPIO13 keeps its existing independent LED behavior.
  restoreBuzzerOff();

  if (!ledcAttach(BUZZER_PIN, BUZZER_FREQUENCY_HZ, BUZZER_RESOLUTION_BITS)) {
    restoreBuzzerOff();
    return false;
  }
  escalation.pwmAttached = true;

  if (!ledcWrite(BUZZER_PIN, BUZZER_DUTY_ON)) {
    restoreBuzzerOff();
    return false;
  }

  const unsigned long nowMs = millis();
  escalation.active = true;
  escalation.toneOn = true;
  escalation.halfStartedMs = nowMs;
  escalation.leaseExpiresMs = nowMs + ESCALATION_LEASE_MS;
  return true;
}

static bool renewEscalation()
{
  if (!escalation.active || !escalation.pwmAttached) return false;
  escalation.leaseExpiresMs = millis() + ESCALATION_LEASE_MS;
  return true;
}

static void stopEscalation()
{
  restoreBuzzerOff();
}

static void updateEscalation()
{
  if (!escalation.active) return;

  const unsigned long nowMs = millis();
  // Signed subtraction handles millis() wraparound correctly.
  if (static_cast<int32_t>(nowMs - escalation.leaseExpiresMs) >= 0) {
    stopEscalation();
    return;
  }

  if (nowMs - escalation.halfStartedMs >= ESCALATION_HALF_CYCLE_MS) {
    escalation.toneOn = !escalation.toneOn;
    escalation.halfStartedMs += ESCALATION_HALF_CYCLE_MS;
    ledcWrite(BUZZER_PIN, escalation.toneOn ? BUZZER_DUTY_ON : BUZZER_DUTY_OFF);
  }
}

static void processLine(char *line)
{
  char *fields[4U] = {nullptr, nullptr, nullptr, nullptr};
  const uint8_t fieldCount = splitFields(line, fields, 4U);

  if (fieldCount == 0U || fieldCount < 3U) {
    sendNack("", "MALFORMED");
    return;
  }
  if (strcmp(fields[0], PROTOCOL_VERSION) != 0) {
    sendNack("", "BAD_VERSION");
    return;
  }
  if (!isValidId(fields[2])) {
    sendNack("", "INVALID_ID");
    return;
  }
  if (!isValidName(fields[1])) {
    sendNack(fields[2], "UNKNOWN_COMMAND");
    return;
  }
  if (fieldCount == 4U && strlen(fields[3]) > MAX_ARG_LENGTH) {
    sendNack(fields[2], "INVALID_ARGUMENT");
    return;
  }

  char id[MAX_ID_LENGTH + 1U];
  char command[MAX_NAME_LENGTH + 1U];
  char argument[MAX_ARG_LENGTH + 1U];
  if (!copyBounded(id, sizeof(id), fields[2]) ||
      !copyBounded(command, sizeof(command), fields[1])) {
    sendNack("", "MALFORMED");
    return;
  }
  argument[0] = '\0';
  if (fieldCount == 4U && !copyBounded(argument, sizeof(argument), fields[3])) {
    sendNack(id, "INVALID_ARGUMENT");
    return;
  }

  if (strcmp(command, "HELLO") == 0) {
    if (argument[0] != '\0') {
      sendNack(id, "INVALID_ARGUMENT");
      return;
    }
    if (!rememberId(id)) {
      sendNack(id, "DUPLICATE");
      return;
    }
    sendHelloAck(id);
    return;
  }

  if (strcmp(command, "ESCALATE") == 0) {
    const bool isStart = strcmp(argument, "START") == 0;
    const bool isRenew = strcmp(argument, "RENEW") == 0;
    const bool isStop = strcmp(argument, "STOP") == 0;
    if (!isStart && !isRenew && !isStop) {
      sendNack(id, "INVALID_ARGUMENT");
      return;
    }
    if (!rememberId(id)) {
      sendNack(id, "DUPLICATE");
      return;
    }

    char extra[32U];
    if (isStart) {
      if (!startEscalation()) {
        sendNack(id, "OUTPUT_ERROR");
        return;
      }
      snprintf(extra, sizeof(extra), "mode=START|lease_ms=%lu", ESCALATION_LEASE_MS);
    } else if (isRenew) {
      if (!renewEscalation()) {
        sendNack(id, "NOT_ACTIVE");
        return;
      }
      snprintf(extra, sizeof(extra), "mode=RENEW|lease_ms=%lu", ESCALATION_LEASE_MS);
    } else {
      stopEscalation();
      snprintf(extra, sizeof(extra), "mode=STOP");
    }
    sendAck(id, command, extra);
    return;
  }

  if (strcmp(command, "TEST") != 0) {
    if (!rememberId(id)) {
      sendNack(id, "DUPLICATE");
      return;
    }
    sendNack(id, "UNKNOWN_COMMAND");
    return;
  }

  const bool ledSelected = strcmp(argument, "LED") == 0 || strcmp(argument, "ALL") == 0;
  const bool buzzerSelected = strcmp(argument, "BUZZER") == 0 || strcmp(argument, "ALL") == 0;
  if (!ledSelected && !buzzerSelected) {
    sendNack(id, "INVALID_ARGUMENT");
    return;
  }
  if (!rememberId(id)) {
    sendNack(id, "DUPLICATE");
    return;
  }

  bool started = true;
  if (buzzerSelected && ledSelected) {
    startLedPulse();
    started = startBuzzerPulse();
    if (!started) digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  } else if (ledSelected) {
    startLedPulse();
  } else {
    started = startBuzzerPulse();
  }

  if (!started) {
    sendNack(id, "OUTPUT_ERROR");
    return;
  }

  char extra[MAX_ARG_LENGTH + 16U];
  snprintf(extra, sizeof(extra), "target=%s", argument);
  sendAck(id, command, extra);
}

static void consumeSerial()
{
  while (Serial.available() > 0) {
    const int incoming = Serial.read();
    if (incoming < 0) return;
    const char ch = static_cast<char>(incoming);

    if (ch == '\n') {
      lineBuffer[lineLength] = '\0';
      processLine(lineBuffer);
      lineLength = 0U;
      continue;
    }
    if (ch == '\r') continue;

    if (ch < 0x20 || ch > 0x7E) {
      lineLength = 0U;
      sendNack("", "MALFORMED");
      continue;
    }
    if (lineLength >= MAX_LINE_LENGTH) {
      lineLength = 0U;
      sendNack("", "LINE_TOO_LONG");
      continue;
    }
    lineBuffer[lineLength++] = ch;
  }
}

void setup()
{
  Serial.begin(SERIAL_BAUD);
  Serial.setTimeout(0);

  // Safe output state before any command is accepted.
  pinMode(EXTERNAL_LED_PIN, OUTPUT);
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, OUTPUT_OFF_LEVEL);

  ledPulse = OutputPulse{false, false, 0, 0};
  buzzerPulse = OutputPulse{false, false, 0, 0};
  escalation = EscalationState{false, false, false, 0, 0};
  lineLength = 0U;
  rememberedCursor = 0U;
  for (uint8_t index = 0U; index < DUPLICATE_CACHE_SIZE; index += 1U) {
    rememberedIds[index][0] = '\0';
  }
}

void loop()
{
  consumeSerial();
  updateLedPulse();
  updateBuzzerPulse();
  updateEscalation();
}
