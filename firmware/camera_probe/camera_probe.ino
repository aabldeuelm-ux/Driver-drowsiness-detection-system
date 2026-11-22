/*
 * camera_probe.ino
 *
 * Controlled camera test for the observed HW-297 ESP32-CAM board.
 *
 * IMPORTANT: The pin map below is a single AI Thinker-style CANDIDATE.
 * It is UNCONFIRMED for this HW-297 board. The supplier guide used for the
 * investigation points to CAMERA_MODEL_AI_THINKER, but it does not prove the
 * internal wiring of our board. Do not treat a successful compile, a correct
 * frame size, or non-zero bytes as proof of correct board wiring or image
 * quality.
 *
 * Scope:
 *   - Arduino-ESP32 3.3.12 APIs.
 *   - One camera initialization attempt only.
 *   - One GPIO mapping only; no GPIO scanning or retry with alternate pins.
 *   - RGB565, QVGA (320x240), one framebuffer in PSRAM.
 *   - CAMERA_GRAB_WHEN_EMPTY.
 *   - 20 MHz XCLK.
 *   - No Wi-Fi, SD, flash LED, buzzer, motor, brownout changes, or unrelated GPIO.
 *
 * Uploading this sketch replaces the firmware currently on the board.
 */

#include <Arduino.h>
#include "esp_camera.h"

/* Single unconfirmed AI Thinker-style candidate mapping. */
static const int CANDIDATE_PIN_PWDN = 32;
static const int CANDIDATE_PIN_RESET = -1;
static const int CANDIDATE_PIN_XCLK = 0;
static const int CANDIDATE_PIN_SIOD = 26;
static const int CANDIDATE_PIN_SIOC = 27;

static const int CANDIDATE_PIN_D0 = 5;
static const int CANDIDATE_PIN_D1 = 18;
static const int CANDIDATE_PIN_D2 = 19;
static const int CANDIDATE_PIN_D3 = 21;
static const int CANDIDATE_PIN_D4 = 36;
static const int CANDIDATE_PIN_D5 = 39;
static const int CANDIDATE_PIN_D6 = 34;
static const int CANDIDATE_PIN_D7 = 35;

static const int CANDIDATE_PIN_VSYNC = 25;
static const int CANDIDATE_PIN_HREF = 23;
static const int CANDIDATE_PIN_PCLK = 22;

static const uint32_t CANDIDATE_XCLK_HZ = 20000000;
static const uint32_t CAPTURE_FRAME_COUNT = 10;
static const size_t EXPECTED_QVGA_RGB565_BYTES = 320U * 240U * 2U;
static const size_t BYTE_SAMPLE_HALF = 8;

static void printSystemInfo()
{
  Serial.println();
  Serial.println(F("=== Camera probe hardware/memory ==="));

  Serial.print(F("Chip model: "));
  Serial.println(ESP.getChipModel());

  Serial.print(F("Chip revision: "));
  Serial.println(static_cast<unsigned int>(ESP.getChipRevision()));

  Serial.print(F("Flash size: "));
  Serial.print(static_cast<unsigned long>(ESP.getFlashChipSize()));
  Serial.println(F(" bytes"));

  Serial.print(F("Free heap: "));
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
    Serial.println(F("PSRAM capacity: n/a"));
    Serial.println(F("PSRAM free: n/a"));
  }

  Serial.println(F("Probe status: camera pin mapping is UNCONFIRMED for HW-297."));
  Serial.println(F("=== end hardware/memory ==="));
  Serial.println();
}

static void printCandidateConfig()
{
  Serial.println(F("=== Candidate camera configuration ==="));
  Serial.println(F("Mapping source: AI Thinker-style candidate from supplier guide +"));
  Serial.println(F("Espressif Arduino-ESP32 3.3.12 CameraWebServer camera_pins.h."));
  Serial.println(F("This mapping is NOT proven for this HW-297 board."));
  Serial.println();

  Serial.print(F("PWDN=")); Serial.print(CANDIDATE_PIN_PWDN);
  Serial.print(F(" RESET=")); Serial.print(CANDIDATE_PIN_RESET);
  Serial.print(F(" XCLK=")); Serial.print(CANDIDATE_PIN_XCLK);
  Serial.print(F(" SIOD/SDA=")); Serial.print(CANDIDATE_PIN_SIOD);
  Serial.print(F(" SIOC/SCL=")); Serial.println(CANDIDATE_PIN_SIOC);

  Serial.print(F("D0=")); Serial.print(CANDIDATE_PIN_D0);
  Serial.print(F(" D1=")); Serial.print(CANDIDATE_PIN_D1);
  Serial.print(F(" D2=")); Serial.print(CANDIDATE_PIN_D2);
  Serial.print(F(" D3=")); Serial.print(CANDIDATE_PIN_D3);
  Serial.print(F(" D4=")); Serial.print(CANDIDATE_PIN_D4);
  Serial.print(F(" D5=")); Serial.print(CANDIDATE_PIN_D5);
  Serial.print(F(" D6=")); Serial.print(CANDIDATE_PIN_D6);
  Serial.print(F(" D7=")); Serial.println(CANDIDATE_PIN_D7);

  Serial.print(F("VSYNC=")); Serial.print(CANDIDATE_PIN_VSYNC);
  Serial.print(F(" HREF=")); Serial.print(CANDIDATE_PIN_HREF);
  Serial.print(F(" PCLK=")); Serial.println(CANDIDATE_PIN_PCLK);

  Serial.print(F("XCLK frequency: "));
  Serial.print(CANDIDATE_XCLK_HZ);
  Serial.println(F(" Hz"));

  Serial.println(F("Pixel format: PIXFORMAT_RGB565"));
  Serial.println(F("Frame size: FRAMESIZE_QVGA (320x240)"));
  Serial.println(F("Framebuffer location: CAMERA_FB_IN_PSRAM"));
  Serial.println(F("Framebuffer count: 1"));
  Serial.println(F("Grab mode: CAMERA_GRAB_WHEN_EMPTY"));
  Serial.print(F("Expected RGB565 frame length: "));
  Serial.print(EXPECTED_QVGA_RGB565_BYTES);
  Serial.println(F(" bytes"));

  Serial.println(F("Wi-Fi, SD, flash LED, buzzer, motor, and unrelated GPIO are unused."));
  Serial.println(F("Brownout protection is not modified."));
  Serial.println(F("=== end candidate configuration ==="));
  Serial.println();
}

static void fillCandidateCameraConfig(camera_config_t &config)
{
  /* Zero every field first, then set every available field explicitly. */
  config = camera_config_t();

  config.pin_pwdn = CANDIDATE_PIN_PWDN;
  config.pin_reset = CANDIDATE_PIN_RESET;
  config.pin_xclk = CANDIDATE_PIN_XCLK;
  config.pin_sccb_sda = CANDIDATE_PIN_SIOD;
  config.pin_sccb_scl = CANDIDATE_PIN_SIOC;

  config.pin_d0 = CANDIDATE_PIN_D0;
  config.pin_d1 = CANDIDATE_PIN_D1;
  config.pin_d2 = CANDIDATE_PIN_D2;
  config.pin_d3 = CANDIDATE_PIN_D3;
  config.pin_d4 = CANDIDATE_PIN_D4;
  config.pin_d5 = CANDIDATE_PIN_D5;
  config.pin_d6 = CANDIDATE_PIN_D6;
  config.pin_d7 = CANDIDATE_PIN_D7;

  config.pin_vsync = CANDIDATE_PIN_VSYNC;
  config.pin_href = CANDIDATE_PIN_HREF;
  config.pin_pclk = CANDIDATE_PIN_PCLK;

  config.xclk_freq_hz = static_cast<int>(CANDIDATE_XCLK_HZ);
  config.ledc_timer = LEDC_TIMER_0;
  config.ledc_channel = LEDC_CHANNEL_0;

  config.pixel_format = PIXFORMAT_RGB565;
  config.frame_size = FRAMESIZE_QVGA;

  /* Explicit even though JPEG is not used. */
  config.jpeg_quality = 0;
  config.jpeg_buffer_size = 0;

  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  /* SCCB pins are provided, so 0 is the normal SCCB/I2C port selection. */
  config.sccb_i2c_port = 0;

#if CONFIG_CAMERA_CONVERTER_ENABLED
  config.conv_mode = CONV_DISABLE;
#endif
}

static const char *formatName(pixformat_t format)
{
  switch (format) {
    case PIXFORMAT_RGB565: return "RGB565";
    case PIXFORMAT_YUV422: return "YUV422";
    case PIXFORMAT_YUV420: return "YUV420";
    case PIXFORMAT_GRAYSCALE: return "GRAYSCALE";
    case PIXFORMAT_JPEG: return "JPEG";
    case PIXFORMAT_RGB888: return "RGB888";
    case PIXFORMAT_RAW: return "RAW";
    case PIXFORMAT_RGB444: return "RGB444";
    case PIXFORMAT_RGB555: return "RGB555";
    case PIXFORMAT_RAW8: return "RAW8";
    default: return "UNKNOWN";
  }
}

static void printHexByte(uint8_t value)
{
  static const char digits[] = "0123456789ABCDEF";
  Serial.print(digits[(value >> 4) & 0x0F]);
  Serial.print(digits[value & 0x0F]);
}

static void printBoundedByteSample(const uint8_t *buf, size_t len)
{
  Serial.print(F("Bounded byte sample: "));

  if (buf == nullptr || len == 0) {
    Serial.println(F("unavailable"));
    return;
  }

  const size_t totalSample = (len <= (BYTE_SAMPLE_HALF * 2))
                               ? len
                               : (BYTE_SAMPLE_HALF * 2);
  const size_t firstEnd = (len < BYTE_SAMPLE_HALF) ? len : BYTE_SAMPLE_HALF;
  const size_t lastStart = (len > (BYTE_SAMPLE_HALF * 2))
                             ? (len - BYTE_SAMPLE_HALF)
                             : firstEnd;

  Serial.print(F("["));
  for (size_t i = 0; i < firstEnd; ++i) {
    if (i > 0) {
      Serial.print(F(" "));
    }
    Serial.print(i);
    Serial.print(F(":0x"));
    printHexByte(buf[i]);
  }

  if (lastStart > firstEnd) {
    Serial.print(F(" ... "));
    for (size_t i = lastStart; i < len; ++i) {
      if (i > lastStart) {
        Serial.print(F(" "));
      }
      Serial.print(i);
      Serial.print(F(":0x"));
      printHexByte(buf[i]);
    }
  }

  Serial.print(F("] ("));
  Serial.print(totalSample);
  Serial.println(F(" bytes shown; not image-quality validation)"));
}

static void printCameraDeinitResult(esp_err_t err)
{
  Serial.print(F("Camera deinit numeric result: "));
  Serial.println(static_cast<int>(err));
  Serial.print(F("Camera deinit error name: "));
  Serial.println(esp_err_to_name(err));
}

static void deinitializeCameraOnce()
{
  /* Cleanup only; no re-initialization and no GPIO changes. */
  const esp_err_t err = esp_camera_deinit();
  printCameraDeinitResult(err);
}

static void printPostTestMemory()
{
  Serial.print(F("Post-test free heap: "));
  Serial.print(static_cast<unsigned long>(ESP.getFreeHeap()));
  Serial.println(F(" bytes"));

  if (psramFound()) {
    Serial.print(F("Post-test PSRAM free: "));
    Serial.print(static_cast<unsigned long>(ESP.getFreePsram()));
    Serial.println(F(" bytes"));
  }
}

static void captureFixedFrames()
{
  uint32_t successfulCaptures = 0;
  uint32_t failedCaptures = 0;

  Serial.println(F("=== Starting bounded capture test ==="));
  Serial.println(F("Success here means a non-null buffer with expected metadata only."));
  Serial.println(F("It does not prove image quality or correct board wiring."));

  delay(200);

  for (uint32_t frameIndex = 0; frameIndex < CAPTURE_FRAME_COUNT; ++frameIndex) {
    Serial.println();
    Serial.print(F("--- Frame "));
    Serial.print(frameIndex + 1);
    Serial.print(F("/"));
    Serial.print(CAPTURE_FRAME_COUNT);
    Serial.println(F(" ---"));

    const uint32_t captureStartUs = micros();
    camera_fb_t *fb = esp_camera_fb_get();
    const uint32_t captureElapsedUs = micros() - captureStartUs;

    Serial.print(F("Capture time: "));
    Serial.print(captureElapsedUs);
    Serial.print(F(" us ("));
    Serial.print(static_cast<float>(captureElapsedUs) / 1000.0f, 3);
    Serial.println(F(" ms)"));

    if (fb == nullptr) {
      ++failedCaptures;
      Serial.println(F("Capture result: FAILED (no framebuffer returned)"));
      continue;
    }

    bool metadataValid = true;

    Serial.print(F("Dimensions: "));
    Serial.print(fb->width);
    Serial.print(F("x"));
    Serial.println(fb->height);
    if ((fb->width != 320U) || (fb->height != 240U)) {
      metadataValid = false;
      Serial.println(F("Validation: FAILED (dimensions are not 320x240)"));
    }

    Serial.print(F("Format: "));
    Serial.println(formatName(fb->format));
    if (fb->format != PIXFORMAT_RGB565) {
      metadataValid = false;
      Serial.println(F("Validation: FAILED (format is not RGB565)"));
    }

    Serial.print(F("Byte length: "));
    Serial.print(fb->len);
    Serial.println(F(" bytes"));
    if (fb->len != EXPECTED_QVGA_RGB565_BYTES) {
      metadataValid = false;
      Serial.print(F("Validation: FAILED (expected "));
      Serial.print(EXPECTED_QVGA_RGB565_BYTES);
      Serial.println(F(" bytes)"));
    }

    printBoundedByteSample(fb->buf, fb->len);

    if (metadataValid) {
      ++successfulCaptures;
      Serial.println(F("Capture result: SUCCESS (metadata only; image quality not assessed)"));
    } else {
      ++failedCaptures;
      Serial.println(F("Capture result: FAILED (metadata validation failed)"));
    }

    esp_camera_fb_return(fb);
    fb = nullptr;

    delay(200);
  }

  Serial.println();
  Serial.println(F("=== Capture summary ==="));
  Serial.print(F("Successful captures: "));
  Serial.println(successfulCaptures);
  Serial.print(F("Failed captures: "));
  Serial.println(failedCaptures);
  Serial.println(F("Capture results describe metadata checks only; image quality remains unverified."));
  Serial.println(F("=== end capture summary ==="));
}

void setup()
{
  Serial.begin(115200);
  delay(100);

  printSystemInfo();
  printCandidateConfig();

  camera_config_t config;
  fillCandidateCameraConfig(config);

  Serial.println(F("=== Camera initialization ==="));
  Serial.println(F("Attempting exactly one esp_camera_init() with the candidate mapping."));

  const esp_err_t initResult = esp_camera_init(&config);

  Serial.print(F("Camera init numeric result: "));
  Serial.println(static_cast<int>(initResult));
  Serial.print(F("Camera init error name: "));
  Serial.println(esp_err_to_name(initResult));

  if (initResult != ESP_OK) {
    Serial.println(F("Camera initialization FAILED."));
    Serial.println(F("Stopping camera testing. No retry, no alternate GPIO mapping."));
    deinitializeCameraOnce();
    printPostTestMemory();
    Serial.println(F("=== Camera probe finished ==="));
    return;
  }

  Serial.println(F("Camera initialization SUCCEEDED with the candidate mapping."));

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor == nullptr) {
    Serial.println(F("Sensor control handle unavailable. Stopping camera testing."));
    deinitializeCameraOnce();
    printPostTestMemory();
    Serial.println(F("=== Camera probe finished ==="));
    return;
  }

  const uint16_t detectedPid = sensor->id.PID;
  Serial.print(F("Detected sensor PID: 0x"));
  Serial.println(static_cast<unsigned int>(detectedPid), HEX);
  Serial.print(F("Expected GC2145_PID: 0x"));
  Serial.println(static_cast<unsigned int>(GC2145_PID), HEX);

  if (detectedPid != GC2145_PID) {
    Serial.println(F("PID mismatch: detected sensor is not GC2145."));
    Serial.println(F("Stopping camera testing. No retry, no alternate GPIO mapping."));
    deinitializeCameraOnce();
    printPostTestMemory();
    Serial.println(F("=== Camera probe finished ==="));
    return;
  }

  Serial.println(F("Sensor PID matches GC2145."));
  captureFixedFrames();

  deinitializeCameraOnce();
  printPostTestMemory();
  Serial.println(F("=== Camera probe finished ==="));
}

void loop()
{
  /* One-shot test. Nothing is polled or changed here. */
  delay(1000);
}
