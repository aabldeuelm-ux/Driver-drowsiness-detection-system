/*
 * camera_preview.ino
 *
 * Local, client-paced RGB565 preview with two software output formats.
 *
 * Camera mapping and format are copied from the physical camera_probe test:
 *   - AI Thinker-style candidate pin map
 *   - RGB565, QVGA (320x240), one framebuffer in PSRAM
 *   - CAMERA_GRAB_WHEN_EMPTY, 20 MHz XCLK
 *
 * That mapping is confirmed on this unit for camera initialization and
 * frame-metadata capture only. It is not proven for HW-297 boards generally.
 *
 * This sketch:
 *   - connects to an existing 2.4 GHz Wi-Fi network using secrets.h
 *   - serves /capture as the unchanged BMP diagnostic endpoint
 *   - serves /capture_jpeg as a software-JPEG comparison endpoint
 *   - captures only when an endpoint is requested; no server push stream
 *   - never requests PIXFORMAT_JPEG from the GC2145
 *   - disables Wi-Fi modem sleep as a documented throughput experiment
 *   - sends read-only CORS headers so the local admin app can fetch snapshots
 *     and trigger bounded hardware tests
 *   - never writes images to flash/SD or uploads them externally
 *   - exposes manual GPIO13 LED and GPIO14 buzzer test buttons on the page
 *
 * Hardware outputs use the wiring and ordering proven by the isolated tests:
 *   GPIO13: 3V3 -> 1 kOhm -> LED anode -> LED cathode -> GPIO13 (active low)
 *   GPIO14: buzzer VCC -> 3V3, GND common, buzzer I/O -> GPIO14 (active low)
 *
 * pinMode(OUTPUT) is called before digitalWrite() for both pins. Both are held
 * HIGH/off at startup; no automatic sound or LED pulse occurs. Each test is a
 * bounded 1 second LOW pulse with automatic HIGH shutoff driven by millis() in
 * loop() and in the image body-write loop; no delay() is used in the alert
 * path. The user reported that both
 * buzzer phases sounded, and steady LOW was chosen for the simple alert, so no
 * PWM/tone/PWM timer is used for GPIO14. The camera's internal LEDC XCLK on
 * GPIO0 is unrelated to GPIO14.
 *
 * Wi-Fi, the web server, the camera, GPIO13, and GPIO14 are used. SD, flash
 * LED, motor, and unrelated outputs are not initialized. Brownout protection
 * is not modified.
 *
 * Uploading this sketch replaces the firmware currently on the board.
 */

#include <Arduino.h>
#include <string.h>
#include <stdlib.h>
#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <WebServer.h>
#include "secrets.h"

/* Exact tested camera pin mapping from firmware/camera_probe/camera_probe.ino. */
static const int CAM_PIN_PWDN = 32;
static const int CAM_PIN_RESET = -1;
static const int CAM_PIN_XCLK = 0;
static const int CAM_PIN_SIOD = 26;
static const int CAM_PIN_SIOC = 27;

static const int CAM_PIN_D0 = 5;
static const int CAM_PIN_D1 = 18;
static const int CAM_PIN_D2 = 19;
static const int CAM_PIN_D3 = 21;
static const int CAM_PIN_D4 = 36;
static const int CAM_PIN_D5 = 39;
static const int CAM_PIN_D6 = 34;
static const int CAM_PIN_D7 = 35;

static const int CAM_PIN_VSYNC = 25;
static const int CAM_PIN_HREF = 23;
static const int CAM_PIN_PCLK = 22;

static const uint32_t CAM_XCLK_HZ = 20000000;
static const uint16_t FRAME_WIDTH = 320;
static const uint16_t FRAME_HEIGHT = 240;

static const size_t RGB565_FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 2U;   /* 153600 */
static const size_t BMP_HEADER_BYTES = 54U;                                  /* 14-byte file header + 40-byte DIB */
static const size_t BMP_PIXEL_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 3U;       /* 230400 */
static const size_t BMP_FRAME_BYTES = BMP_HEADER_BYTES + BMP_PIXEL_BYTES;    /* 230454 */

/* Software JPEG is produced from the RGB565 framebuffer, never by the sensor. */
static const uint8_t SOFTWARE_JPEG_QUALITY = 12;

static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000UL;

/*
 * Visible build identity. It is printed at startup, shown on the preview page,
 * returned by GET /version, and sent as X-Firmware-Build on every response so
 * the admin can report which revision it is actually talking to. Bump this
 * whenever timing or endpoints change.
 */
static const char FIRMWARE_BUILD_ID[] =
    "camera_preview-2026-11-22-1s-5fps-v5-diagnostics";

/* Outputs proven by the isolated LED and buzzer tests. Both are active low. */
static const int EXTERNAL_LED_PIN = 13;
static const int BUZZER_PIN = 14;
static const uint8_t OUTPUT_OFF_LEVEL = HIGH;
static const uint8_t OUTPUT_ON_LEVEL = LOW;
static const unsigned long OUTPUT_TEST_ACTIVE_MS = 1000UL;

/*
 * Body-send diagnostics. NetworkClient::write() can block inside one call and
 * return a partial count, so progress is measured per successful write.
 * The absolute cap is TEMPORARY DIAGNOSTIC ONLY: it lets a slow transfer
 * continue long enough to measure real progress in the next physical test.
 */
static const uint32_t TEMP_DIAGNOSTIC_RESPONSE_LIMIT_MS = 15000UL;
static const uint32_t RESPONSE_WRITE_STALL_MS = 2000UL;
static const size_t RESPONSE_WRITE_CHUNK_BYTES = 2048U;
static const size_t RESPONSE_PROGRESS_LOG_BYTES = 65536U;

/* Declared before any function signatures so Arduino's auto-prototypes compile. */
enum class BodySendOutcome
{
  Complete,
  Timeout,
  Stall,
  Disconnect
};

struct BodySendStats
{
  uint32_t totalMs;
  uint32_t sinceLastWriteMs;
  uint32_t longestNoProgressMs;
  uint32_t writeCalls;
  uint32_t shortWrites;
  uint32_t zeroWrites;
};

/* One bounded, nonblocking active-low output pulse. */
struct OutputPulse
{
  bool active;
  unsigned long startedMs;
  unsigned long durationMs;
};

/* RAII guard so every capture exit releases the single capture slot. */
class CaptureGuard
{
public:
  explicit CaptureGuard(bool &flag) : _flag(flag), _owned(!flag)
  {
    if (_owned) {
      _flag = true;
    }
  }

  ~CaptureGuard()
  {
    if (_owned) {
      _flag = false;
    }
  }

  bool owned() const { return _owned; }

private:
  bool &_flag;
  bool _owned;
};

static WebServer server(80);
static uint32_t captureRequestCount = 0;
static bool captureBusy = false;
static OutputPulse ledPulse = {false, 0, 0};
static OutputPulse buzzerPulse = {false, 0, 0};

/*
 * Diagnostics only. lastBodySendMs is from the previous image response because
 * response headers are sent before the body is written. wifiSleepEnabled is
 * the runtime value after setup (0 means modem sleep is disabled).
 */
static uint32_t lastBodySendMs = 0;
static int wifiSleepEnabledAfterSetup = -1;

/* Defined with the output handlers; called from the long body-write loop too. */
static void updateOutputPulses();

static const char PAGE_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local GC2145 preview</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 44rem; }
    button { font-size: 1rem; padding: 0.55rem 0.9rem; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .controls { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .stats { margin: 1rem 0; line-height: 1.5; }
    .stats span { font-variant-numeric: tabular-nums; }
    #status { color: #333; }
    img { display: block; margin-top: 1rem; max-width: 100%; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>Local camera preview</h1>
  <p>Build: <strong id="build">__BUILD_ID__</strong> · pulses 1000 ms · default 5 FPS</p>
  <p>Local frames only. JPEG is the default preview; BMP remains for transfer diagnostics. The FPS field is a target, not a measured rate.</p>

  <div class="controls">
    <button id="start" type="button">Start preview</button>
    <button id="stop" type="button">Stop preview</button>
    <button id="capture" type="button">Capture image</button>
    <button id="ledTest" type="button">Test LED (GPIO13)</button>
    <button id="buzzerTest" type="button">Test buzzer (GPIO14)</button>
    <label for="format">Format:</label>
    <select id="format">
      <option value="jpeg" selected>JPEG (software)</option>
      <option value="bmp">BMP (diagnostic)</option>
    </select>
    <label for="rate">Rate:</label>
    <input id="rate" type="number" min="0.2" max="10" step="0.1" value="5">
    <span>FPS target</span>
  </div>

  <div class="stats">
    <div>Preview state: <span id="state">Stopped</span></div>
    <div>Image format: <span id="imageFormat">&mdash;</span></div>
    <div>Payload bytes: <span id="payloadBytes">&mdash;</span></div>
    <div>Displayed FPS: <span id="fps">0.0</span></div>
    <div>Request latency: <span id="latency">&mdash;</span></div>
    <div>Frame age (request to display): <span id="age">&mdash;</span></div>
    <div>Server frame: <span id="frame">&mdash;</span></div>
    <div>Errors: <span id="errors">0</span></div>
    <div>Server capture: <span id="serverCapture">&mdash;</span></div>
    <div>Server conversion: <span id="serverConversion">&mdash;</span></div>
    <div>Server body write (previous): <span id="serverSend">&mdash;</span></div>
    <div>Headers received: <span id="headersAt">&mdash;</span></div>
    <div>Body after headers: <span id="bodyMs">&mdash;</span></div>
    <div>Decode to display: <span id="decodeMs">&mdash;</span></div>
    <div>Wi-Fi sleep enabled: <span id="wifiSleep">&mdash;</span></div>
    <div>Hardware outputs (local UI, no polling): <span id="outputs">LED OFF &middot; Buzzer OFF</span></div>
  </div>

  <p id="status">Ready.</p>
  <img id="preview" alt="Captured frame appears here">

  <script>
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const captureButton = document.getElementById('capture');
    const formatSelect = document.getElementById('format');
    const rateInput = document.getElementById('rate');
    const stateValue = document.getElementById('state');
    const formatValue = document.getElementById('imageFormat');
    const payloadValue = document.getElementById('payloadBytes');
    const fpsValue = document.getElementById('fps');
    const latencyValue = document.getElementById('latency');
    const ageValue = document.getElementById('age');
    const frameValue = document.getElementById('frame');
    const errorsValue = document.getElementById('errors');
    const serverCaptureValue = document.getElementById('serverCapture');
    const serverConversionValue = document.getElementById('serverConversion');
    const serverSendValue = document.getElementById('serverSend');
    const headersAtValue = document.getElementById('headersAt');
    const bodyMsValue = document.getElementById('bodyMs');
    const decodeMsValue = document.getElementById('decodeMs');
    const wifiSleepValue = document.getElementById('wifiSleep');
    const outputsValue = document.getElementById('outputs');
    const ledTestButton = document.getElementById('ledTest');
    const buzzerTestButton = document.getElementById('buzzerTest');
    const statusText = document.getElementById('status');
    const preview = document.getElementById('preview');

    /* BMP is diagnostic-only: measured server send time was ~14.4 s. */
    const JPEG_NETWORK_TIMEOUT_MS = 4000;
    const BMP_DIAGNOSTIC_NETWORK_TIMEOUT_MS = 20000;
    const DECODE_TIMEOUT_MS = 2000;
    const RETRY_BASE_MS = 600;
    const RETRY_MAX_MS = 4000;
    const FPS_WINDOW_MS = 2000;
    const OUTPUT_TEST_ACTIVE_MS = 1000;
    const OUTPUT_STATUS_MARGIN_MS = 100;

    let outputStatusTimer = null;
    let previewRunning = false;
    let inFlight = false;
    let scheduledTimer = null;
    let activeController = null;
    let currentObjectUrl = null;
    let requestSeq = 0;
    let errorCount = 0;
    let errorStreak = 0;
    let cancelToken = 0;
    let displayTimes = [];

    function setStatus(message) {
      statusText.textContent = message;
    }

    function showOutputActive(activeLabel) {
      if (outputStatusTimer !== null) {
        clearTimeout(outputStatusTimer);
        outputStatusTimer = null;
      }
      outputsValue.textContent = activeLabel;
      outputStatusTimer = setTimeout(function() {
        outputsValue.textContent = 'LED OFF · Buzzer OFF';
        outputStatusTimer = null;
      }, OUTPUT_TEST_ACTIVE_MS + OUTPUT_STATUS_MARGIN_MS);
    }

    async function triggerOutputTest(endpoint, activeLabel, testName) {
      try {
        const response = await fetch(endpoint + '?t=' + Date.now(), {cache: 'no-store'});
        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch (ignored) {}
          throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
        }
        showOutputActive(activeLabel);
        setStatus(testName + ' started; firmware returns the output HIGH/off automatically.');
      } catch (error) {
        setStatus(testName + ' failed: ' + (error && error.message ? error.message : 'unknown error'));
      }
    }

    function selectedFormat() {
      return formatSelect.value === 'bmp' ? 'bmp' : 'jpeg';
    }

    function endpointForFormat(format) {
      return format === 'bmp' ? '/capture' : '/capture_jpeg';
    }

    function networkTimeoutForFormat(format) {
      return format === 'bmp' ? BMP_DIAGNOSTIC_NETWORK_TIMEOUT_MS : JPEG_NETWORK_TIMEOUT_MS;
    }

    function configuredFps() {
      let value = parseFloat(rateInput.value);
      if (!isFinite(value) || value < 0.2) value = 0.2;
      if (value > 10) value = 10;
      rateInput.value = value.toFixed(1);
      return value;
    }

    function updateButtons() {
      startButton.disabled = previewRunning || inFlight;
      stopButton.disabled = !previewRunning;
      captureButton.disabled = previewRunning || inFlight;
      stateValue.textContent = previewRunning ? 'Running' : 'Stopped';
    }

    function updateDisplayedFps(now) {
      const cutoff = now - FPS_WINDOW_MS;
      while (displayTimes.length > 0 && displayTimes[0] < cutoff) displayTimes.shift();
      if (displayTimes.length < 2) {
        fpsValue.textContent = '0.0';
        return;
      }
      const spanSeconds = (displayTimes[displayTimes.length - 1] - displayTimes[0]) / 1000;
      const fps = spanSeconds > 0 ? (displayTimes.length - 1) / spanSeconds : 0;
      fpsValue.textContent = fps.toFixed(1);
    }

    function releaseCurrentObjectUrl() {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
    }

    function decodeImage(blob, timeoutMs) {
      return new Promise(function(resolve, reject) {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        let settled = false;
        let timerId = null;

        function fail(message) {
          if (settled) return;
          settled = true;
          if (timerId !== null) clearTimeout(timerId);
          URL.revokeObjectURL(url);
          reject(new Error(message));
        }

        function succeed() {
          if (settled) return;
          settled = true;
          if (timerId !== null) clearTimeout(timerId);
          resolve({ url: url, image: image });
        }

        timerId = setTimeout(function() {
          fail('image decode timeout');
        }, Math.max(0, timeoutMs));

        image.onload = succeed;
        image.onerror = function() { fail('image decode failed'); };
        image.src = url;

        if (image.decode) {
          // Some browsers reject decode() for blob URLs even when onload will
          // succeed. onload and the timeout remain authoritative.
          image.decode().then(succeed).catch(function() {});
        }
      });
    }

    async function displayBlob(blob, requestStartedAt, requestToken, serverFrame, decodeTimeoutMs) {
      const decoded = await decodeImage(blob, decodeTimeoutMs);
      if (requestToken !== cancelToken) {
        URL.revokeObjectURL(decoded.url);
        return { shown: false, displayedAt: null };
      }

      releaseCurrentObjectUrl();
      currentObjectUrl = decoded.url;
      preview.src = currentObjectUrl;

      const displayedAt = performance.now();
      displayTimes.push(displayedAt);
      updateDisplayedFps(displayedAt);
      ageValue.textContent = (displayedAt - requestStartedAt).toFixed(0) + ' ms';
      frameValue.textContent = '#' + serverFrame;
      return { shown: true, displayedAt: displayedAt };
    }

    async function requestFrame() {
      if (inFlight) return { ok: false, aborted: false };

      inFlight = true;
      updateButtons();

      const requestToken = cancelToken;
      const controller = new AbortController();
      const requestStartedAt = performance.now();
      const seq = ++requestSeq;
      const format = selectedFormat();
      const endpoint = endpointForFormat(format);
      let networkTimedOut = false;
      let timeoutId = null;

      activeController = controller;
      timeoutId = setTimeout(function() {
        networkTimedOut = true;
        controller.abort();
      }, networkTimeoutForFormat(format));

      try {
        setStatus('Requesting ' + format.toUpperCase() + ' frame #' + seq + '...');
        const response = await fetch(endpoint + '?seq=' + seq + '&t=' + Date.now(), {
          cache: 'no-store',
          signal: controller.signal
        });

        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch (ignored) {}
          throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
        }

        const headersReceivedAt = performance.now();
        formatValue.textContent = (response.headers.get('X-Image-Format') || format).toUpperCase();

        const captureUs = Number(response.headers.get('X-Capture-Latency-Us'));
        serverCaptureValue.textContent = Number.isFinite(captureUs) && captureUs > 0
          ? (captureUs / 1000).toFixed(0) + ' ms'
          : '\u2014';
        const conversionMs = Number(response.headers.get('X-Conversion-Ms'));
        serverConversionValue.textContent = Number.isFinite(conversionMs) && conversionMs > 0
          ? conversionMs.toFixed(0) + ' ms'
          : '\u2014';
        const lastSendMs = Number(response.headers.get('X-Last-Body-Send-Ms'));
        serverSendValue.textContent = Number.isFinite(lastSendMs) && lastSendMs >= 0
          ? lastSendMs.toFixed(0) + ' ms'
          : '\u2014';
        const wifiSleep = response.headers.get('X-Wifi-Sleep-Enabled');
        wifiSleepValue.textContent = wifiSleep === '1' ? 'yes' : wifiSleep === '0' ? 'no' : '\u2014';

        setStatus('Frame #' + seq + ' headers received; reading body...');
        const blob = await response.blob();
        const bodyReceivedAt = performance.now();

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (activeController === controller) activeController = null;

        const expectedBodyBytes = Number(response.headers.get('X-Body-Bytes'));
        payloadValue.textContent = Number.isFinite(expectedBodyBytes) && expectedBodyBytes > 0
          ? String(expectedBodyBytes)
          : String(blob.size);
        if (Number.isFinite(expectedBodyBytes) && expectedBodyBytes > 0 && blob.size !== expectedBodyBytes) {
          throw new Error('incomplete image body: expected ' + expectedBodyBytes + ', received ' + blob.size);
        }

        headersAtValue.textContent = (headersReceivedAt - requestStartedAt).toFixed(0) + ' ms';
        bodyMsValue.textContent = (bodyReceivedAt - headersReceivedAt).toFixed(0) + ' ms';
        latencyValue.textContent = (bodyReceivedAt - requestStartedAt).toFixed(0) + ' ms';

        const serverFrame = response.headers.get('X-Server-Frame') || String(seq);
        const displayResult = await displayBlob(
          blob, requestStartedAt, requestToken, serverFrame, DECODE_TIMEOUT_MS,
        );
        if (!displayResult.shown) return { ok: false, aborted: true };
        decodeMsValue.textContent =
          (displayResult.displayedAt - bodyReceivedAt).toFixed(0) + ' ms';

        errorStreak = 0;
        return { ok: true, aborted: false };
      } catch (error) {
        if (requestToken !== cancelToken) {
          return { ok: false, aborted: true };
        }
        errorCount += 1;
        errorStreak += 1;
        errorsValue.textContent = String(errorCount);
        const reason = networkTimedOut ? 'network timeout' : (error && error.message ? error.message : 'unknown error');
        setStatus('Request failed: ' + reason);
        return { ok: false, aborted: false };
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (activeController === controller) activeController = null;
        inFlight = false;
        updateButtons();
      }
    }

    function schedulePreviewTick(delayMs) {
      if (scheduledTimer !== null) {
        clearTimeout(scheduledTimer);
        scheduledTimer = null;
      }
      if (!previewRunning) return;

      scheduledTimer = setTimeout(function() {
        scheduledTimer = null;
        if (!previewRunning) return;

        const tickStartedAt = performance.now();
        requestFrame().then(function(result) {
          if (!previewRunning || result.aborted) return;

          const elapsed = performance.now() - tickStartedAt;
          const targetInterval = 1000 / configuredFps();
          let delay;

          if (result.ok) {
            delay = Math.max(0, targetInterval - elapsed);
            setStatus('Previewing at ' + configuredFps().toFixed(1) + ' FPS target.');
          } else {
            delay = Math.min(RETRY_BASE_MS * errorStreak, RETRY_MAX_MS);
          }

          schedulePreviewTick(delay);
        });
      }, delayMs);
    }

    function startPreview() {
      if (previewRunning || inFlight) return;
      previewRunning = true;
      errorStreak = 0;
      displayTimes = [];
      updateDisplayedFps(performance.now());
      updateButtons();
      setStatus('Preview starting at ' + configuredFps().toFixed(1) + ' FPS using ' + selectedFormat().toUpperCase() + '...');
      schedulePreviewTick(0);
    }

    function stopPreview(message) {
      const wasActive = previewRunning || inFlight;
      previewRunning = false;
      cancelToken += 1;

      if (scheduledTimer !== null) {
        clearTimeout(scheduledTimer);
        scheduledTimer = null;
      }
      if (activeController) {
        try { activeController.abort(); } catch (ignored) {}
        activeController = null;
      }

      releaseCurrentObjectUrl();
      preview.removeAttribute('src');
      displayTimes = [];
      ageValue.textContent = '\u2014';
      latencyValue.textContent = '\u2014';
      frameValue.textContent = '\u2014';
      formatValue.textContent = '\u2014';
      payloadValue.textContent = '\u2014';
      serverCaptureValue.textContent = '\u2014';
      serverConversionValue.textContent = '\u2014';
      serverSendValue.textContent = '\u2014';
      headersAtValue.textContent = '\u2014';
      bodyMsValue.textContent = '\u2014';
      decodeMsValue.textContent = '\u2014';
      wifiSleepValue.textContent = '\u2014';
      updateDisplayedFps(performance.now());
      updateButtons();

      if (message) {
        setStatus(message);
      } else {
        setStatus(wasActive ? 'Preview stopped. Single capture is available.' : 'Ready.');
      }
    }

    startButton.addEventListener('click', startPreview);
    stopButton.addEventListener('click', function() { stopPreview(); });
    formatSelect.addEventListener('change', function() {
      formatValue.textContent = '\u2014';
      payloadValue.textContent = '\u2014';
      setStatus('Format set to ' + selectedFormat().toUpperCase() + '.');
    });

    captureButton.addEventListener('click', async function() {
      if (previewRunning || inFlight) return;
      const result = await requestFrame();
      if (result.ok && !previewRunning) {
        setStatus('Single capture complete. Server frame ' + frameValue.textContent + '.');
      }
    });

    ledTestButton.addEventListener('click', function() {
      triggerOutputTest('/led_test', 'LED test active · auto-off', 'LED test');
    });

    buzzerTestButton.addEventListener('click', function() {
      triggerOutputTest('/buzzer_test', 'Buzzer test active · auto-off', 'Buzzer test');
    });

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopPreview('Page hidden: preview stopped. Press Start preview when visible again.');
      }
    });

    setInterval(function() { updateDisplayedFps(performance.now()); }, 500);
    updateButtons();
    updateDisplayedFps(performance.now());
  </script>
</body>
</html>
)rawliteral";

static void printStartupInfo()
{
  Serial.println();
  Serial.println(F("=== Camera preview startup ==="));
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

  if (psramFound()) {
    Serial.print(F("PSRAM capacity: "));
    Serial.print(static_cast<unsigned long>(ESP.getPsramSize()));
    Serial.println(F(" bytes"));
    Serial.print(F("PSRAM free: "));
    Serial.print(static_cast<unsigned long>(ESP.getFreePsram()));
    Serial.println(F(" bytes"));
  } else {
    Serial.println(F("PSRAM detected: no (camera config requires PSRAM)"));
  }

  Serial.println(F("Camera mapping: exact tested AI Thinker-style map from camera_probe."));
  Serial.println(F("Confirmed on this unit for init + frame metadata only; image quality unverified."));
  Serial.print(F("PWDN=")); Serial.print(CAM_PIN_PWDN);
  Serial.print(F(" RESET=")); Serial.print(CAM_PIN_RESET);
  Serial.print(F(" XCLK=")); Serial.print(CAM_PIN_XCLK);
  Serial.print(F(" SIOD=")); Serial.print(CAM_PIN_SIOD);
  Serial.print(F(" SIOC=")); Serial.println(CAM_PIN_SIOC);
  Serial.print(F("D0-D7="));
  Serial.print(CAM_PIN_D0); Serial.print(F(","));
  Serial.print(CAM_PIN_D1); Serial.print(F(","));
  Serial.print(CAM_PIN_D2); Serial.print(F(","));
  Serial.print(CAM_PIN_D3); Serial.print(F(","));
  Serial.print(CAM_PIN_D4); Serial.print(F(","));
  Serial.print(CAM_PIN_D5); Serial.print(F(","));
  Serial.print(CAM_PIN_D6); Serial.print(F(","));
  Serial.println(CAM_PIN_D7);
  Serial.print(F("VSYNC=")); Serial.print(CAM_PIN_VSYNC);
  Serial.print(F(" HREF=")); Serial.print(CAM_PIN_HREF);
  Serial.print(F(" PCLK=")); Serial.println(CAM_PIN_PCLK);

  Serial.print(F("Format: RGB565, frame: "));
  Serial.print(FRAME_WIDTH);
  Serial.print(F("x"));
  Serial.println(FRAME_HEIGHT);
  Serial.println(F("Framebuffer: 1 in PSRAM; grab mode: CAMERA_GRAB_WHEN_EMPTY"));
  Serial.print(F("XCLK: "));
  Serial.print(CAM_XCLK_HZ);
  Serial.println(F(" Hz"));
  Serial.print(F("Expected RGB565 frame: "));
  Serial.print(RGB565_FRAME_BYTES);
  Serial.println(F(" bytes"));
  Serial.print(F("Expected uncompressed BMP: "));
  Serial.print(BMP_FRAME_BYTES);
  Serial.println(F(" bytes (54-byte header + 24-bit BGR pixels)"));
  Serial.println(F("BMP conversion uses Espressif frame2bmp()."));
  Serial.println(F("Installed API: RGB565 high byte = R5/G3, low byte = G3/B5; output BGR."));
  Serial.println(F("BMP layout: 'BM', 40-byte DIB, negative height, BI_RGB, no palette."));
  Serial.print(F("Software JPEG endpoint quality: "));
  Serial.println(SOFTWARE_JPEG_QUALITY);
  Serial.println(F("JPEG is converted from RGB565 with Espressif frame2jpg(); sensor JPEG is not requested."));
  Serial.println(F("=== end startup info ==="));
  Serial.println();
}

static void fillTestedCameraConfig(camera_config_t &config)
{
  config = camera_config_t();

  config.pin_pwdn = CAM_PIN_PWDN;
  config.pin_reset = CAM_PIN_RESET;
  config.pin_xclk = CAM_PIN_XCLK;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;

  config.pin_d0 = CAM_PIN_D0;
  config.pin_d1 = CAM_PIN_D1;
  config.pin_d2 = CAM_PIN_D2;
  config.pin_d3 = CAM_PIN_D3;
  config.pin_d4 = CAM_PIN_D4;
  config.pin_d5 = CAM_PIN_D5;
  config.pin_d6 = CAM_PIN_D6;
  config.pin_d7 = CAM_PIN_D7;

  config.pin_vsync = CAM_PIN_VSYNC;
  config.pin_href = CAM_PIN_HREF;
  config.pin_pclk = CAM_PIN_PCLK;

  config.xclk_freq_hz = static_cast<int>(CAM_XCLK_HZ);
  config.ledc_timer = LEDC_TIMER_0;
  config.ledc_channel = LEDC_CHANNEL_0;

  config.pixel_format = PIXFORMAT_RGB565;
  config.frame_size = FRAMESIZE_QVGA;

  config.jpeg_quality = 0;
  config.jpeg_buffer_size = 0;

  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.sccb_i2c_port = 0;

#if CONFIG_CAMERA_CONVERTER_ENABLED
  config.conv_mode = CONV_DISABLE;
#endif
}

static void printDeinitResult(esp_err_t err)
{
  Serial.print(F("Camera deinit numeric result: "));
  Serial.println(static_cast<int>(err));
  Serial.print(F("Camera deinit error name: "));
  Serial.println(esp_err_to_name(err));
}

static bool initializeCameraOnce()
{
  camera_config_t config;
  fillTestedCameraConfig(config);

  Serial.println(F("=== Camera initialization ==="));
  Serial.println(F("Attempting exactly one esp_camera_init() with the tested mapping."));

  const esp_err_t err = esp_camera_init(&config);

  Serial.print(F("Camera init numeric result: "));
  Serial.println(static_cast<int>(err));
  Serial.print(F("Camera init error name: "));
  Serial.println(esp_err_to_name(err));

  if (err != ESP_OK) {
    Serial.println(F("Camera initialization FAILED. Preview server will not start."));
    printDeinitResult(esp_camera_deinit());
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor == nullptr) {
    Serial.println(F("Sensor control handle unavailable. Preview server will not start."));
    printDeinitResult(esp_camera_deinit());
    return false;
  }

  const uint16_t pid = sensor->id.PID;
  Serial.print(F("Detected sensor PID: 0x"));
  Serial.println(static_cast<unsigned int>(pid), HEX);
  Serial.print(F("Expected GC2145_PID: 0x"));
  Serial.println(static_cast<unsigned int>(GC2145_PID), HEX);

  if (pid != GC2145_PID) {
    Serial.println(F("PID mismatch. Preview server will not start."));
    printDeinitResult(esp_camera_deinit());
    return false;
  }

  Serial.println(F("Camera initialization succeeded; PID matches GC2145."));
  Serial.println(F("=== end camera initialization ==="));
  Serial.println();
  return true;
}

static bool connectToWiFi()
{
  if (strcmp(CAMERA_PREVIEW_WIFI_SSID, "YOUR_2_4GHZ_WIFI_SSID") == 0 ||
      strcmp(CAMERA_PREVIEW_WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0) {
    Serial.println(F("Wi-Fi setup error: secrets.h still contains placeholder values."));
    Serial.println(F("Edit firmware/camera_preview/secrets.h, then recompile and upload."));
    return false;
  }

  Serial.println(F("=== Wi-Fi connection ==="));
  Serial.print(F("Connecting to SSID: "));
  Serial.println(CAMERA_PREVIEW_WIFI_SSID);
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
  Serial.print(F("Wi-Fi sleep disable request result: "));
  Serial.println(sleepDisabled ? F("ok") : F("failed"));
  wifiSleepEnabledAfterSetup = static_cast<int>(WiFi.getSleep());
  Serial.print(F("Wi-Fi sleep mode after performance change (numeric; 0=disabled): "));
  Serial.println(wifiSleepEnabledAfterSetup);
  Serial.println(F("Performance change: modem sleep disabled for TCP transfer testing."));
  Serial.println(F("=== end Wi-Fi connection ==="));
  Serial.println();
  return true;
}

static uint16_t readLE16(const uint8_t *buf, size_t offset)
{
  return static_cast<uint16_t>(buf[offset]) |
         static_cast<uint16_t>(static_cast<uint16_t>(buf[offset + 1]) << 8);
}

static uint32_t readLE32(const uint8_t *buf, size_t offset)
{
  return static_cast<uint32_t>(buf[offset]) |
         (static_cast<uint32_t>(buf[offset + 1]) << 8) |
         (static_cast<uint32_t>(buf[offset + 2]) << 16) |
         (static_cast<uint32_t>(buf[offset + 3]) << 24);
}

static const char *validateBmpHeader(const uint8_t *bmp, size_t bmpLen)
{
  if (bmp == nullptr || bmpLen < BMP_HEADER_BYTES) {
    return "buffer is shorter than the 54-byte BMP header";
  }
  if (bmp[0] != 'B' || bmp[1] != 'M') {
    return "missing 'BM' file signature";
  }
  if (readLE32(bmp, 2) != bmpLen) {
    return "BMP filesize field does not match the conversion buffer length";
  }
  if (readLE32(bmp, 10) != BMP_HEADER_BYTES) {
    return "BMP pixel-array offset is not 54";
  }
  if (readLE32(bmp, 14) != 40U) {
    return "BMP DIB header size is not 40";
  }
  if (readLE32(bmp, 18) != FRAME_WIDTH) {
    return "BMP width is not 320";
  }
  if (readLE32(bmp, 22) != static_cast<uint32_t>(-static_cast<int32_t>(FRAME_HEIGHT))) {
    return "BMP height is not negative/top-down -240";
  }
  if (readLE16(bmp, 26) != 1U) {
    return "BMP planes field is not 1";
  }
  if (readLE16(bmp, 28) != 24U) {
    return "BMP bits-per-pixel is not 24";
  }
  if (readLE32(bmp, 30) != 0U) {
    return "BMP compression is not BI_RGB";
  }
  if (readLE32(bmp, 34) != BMP_PIXEL_BYTES) {
    return "BMP image-size field is not 320*240*3";
  }
  return nullptr;
}

/*
 * Mirrors the installed esp32-camera 3.3.12 fmt2bmp() RGB565 conversion:
 *   high byte = RRRRRGGG, low byte = GGGBBBBB
 *   BMP pixel bytes = B, G, R
 */
static const char *validateRgb565PixelAt(const uint8_t *rgb565, size_t rgb565Offset,
                                         const uint8_t *bmp, size_t bmpOffset)
{
  const uint8_t hb = rgb565[rgb565Offset];
  const uint8_t lb = rgb565[rgb565Offset + 1];

  const uint8_t expectedB = static_cast<uint8_t>((lb & 0x1FU) << 3);
  const uint8_t expectedG = static_cast<uint8_t>(((hb & 0x07U) << 5) | ((lb & 0xE0U) >> 3));
  const uint8_t expectedR = static_cast<uint8_t>(hb & 0xF8U);

  if (bmp[bmpOffset] != expectedB) {
    return "blue byte does not match RGB565 low-byte B5 bits";
  }
  if (bmp[bmpOffset + 1] != expectedG) {
    return "green byte does not match RGB565 G3+G3 bits";
  }
  if (bmp[bmpOffset + 2] != expectedR) {
    return "red byte does not match RGB565 high-byte R5 bits";
  }
  return nullptr;
}

static const char *validateJpegMarkers(const uint8_t *jpeg, size_t jpegLen)
{
  if (jpeg == nullptr || jpegLen < 4U) {
    return "JPEG buffer is null or shorter than 4 bytes";
  }
  if (jpeg[0] != 0xFFU || jpeg[1] != 0xD8U) {
    return "JPEG SOI marker 0xFFD8 is missing";
  }
  if (jpeg[jpegLen - 2U] != 0xFFU || jpeg[jpegLen - 1U] != 0xD9U) {
    return "JPEG EOI marker 0xFFD9 is missing";
  }
  return nullptr;
}

static void addCorsHeaders()
{
  server.sendHeader(F("X-Firmware-Build"), String(FIRMWARE_BUILD_ID));
  server.sendHeader(F("Access-Control-Allow-Origin"), F("*"));
  server.sendHeader(F("Access-Control-Allow-Methods"), F("GET, OPTIONS"));
  server.sendHeader(F("Access-Control-Allow-Headers"), F("Content-Type"));
  server.sendHeader(F("Access-Control-Allow-Private-Network"), F("true"));
}

static void sendText(int code, const char *message)
{
  if (!server.client().connected()) {
    Serial.println(F("Client disconnected; skipping text response."));
    return;
  }
  server.sendHeader(F("Cache-Control"), F("no-store"));
  addCorsHeaders();
  server.send(code, "text/plain; charset=utf-8", message);
}

static void handleOptions()
{
  addCorsHeaders();
  server.sendHeader(F("Cache-Control"), F("no-store"));
  server.send(204, "text/plain", "");
}

static void startOutputPulse(OutputPulse &pulse, int pin, const char *name)
{
  pulse.active = true;
  pulse.startedMs = millis();
  pulse.durationMs = OUTPUT_TEST_ACTIVE_MS;
  digitalWrite(pin, OUTPUT_ON_LEVEL);

  Serial.print(F("Output test started: "));
  Serial.print(name);
  Serial.print(F(" on GPIO"));
  Serial.print(pin);
  Serial.print(F(" LOW for "));
  Serial.print(OUTPUT_TEST_ACTIVE_MS);
  Serial.println(F(" ms; automatic HIGH/off pending."));
}

static void updateOutputPulse(OutputPulse &pulse, int pin, const char *name)
{
  if (!pulse.active) return;
  if (millis() - pulse.startedMs < pulse.durationMs) return;

  digitalWrite(pin, OUTPUT_OFF_LEVEL);
  pulse.active = false;

  Serial.print(F("Output test auto-off: "));
  Serial.print(name);
  Serial.print(F(" on GPIO"));
  Serial.print(pin);
  Serial.println(F(" returned HIGH/off."));
}

static void updateOutputPulses()
{
  updateOutputPulse(ledPulse, EXTERNAL_LED_PIN, "LED");
  updateOutputPulse(buzzerPulse, BUZZER_PIN, "Buzzer");
}

static void handleLedTest()
{
  startOutputPulse(ledPulse, EXTERNAL_LED_PIN, "LED");
  sendText(200, "LED test started: GPIO13 LOW for 1000 ms, then HIGH/off automatically.");
}

static void handleBuzzerTest()
{
  startOutputPulse(buzzerPulse, BUZZER_PIN, "Buzzer");
  sendText(200, "Buzzer test started: GPIO14 LOW for 1000 ms, then HIGH/off automatically.");
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

static void handleVersion()
{
  char body[240];
  snprintf(body, sizeof(body),
           "build=%s; pulse_ms=%lu; default_fps=5; camera=GC2145 RGB565 QVGA; "
           "wifi_sleep_enabled=%d; last_body_send_ms=%lu",
           FIRMWARE_BUILD_ID, OUTPUT_TEST_ACTIVE_MS,
           wifiSleepEnabledAfterSetup,
           static_cast<unsigned long>(lastBodySendMs));
  sendText(200, body);
}

static void handleNotFound()
{
  sendText(404, "Not found. Open the root page with /");
}

/*
 * Writes the BMP body with explicit partial-write accounting. Outcomes are
 * based on progress and disconnect state, not only total elapsed time.
 * WebServer::sendContent() discards write() return values; this does not.
 */
static BodySendOutcome writeBodyFully(NetworkClient &client,
                                      const uint8_t *data,
                                      size_t length,
                                      size_t &bytesWritten,
                                      BodySendStats &stats,
                                      const char *&reason)
{
  const uint32_t startMs = millis();
  uint32_t lastProgressMs = startMs;
  size_t nextProgressLog = RESPONSE_PROGRESS_LOG_BYTES;

  bytesWritten = 0;
  reason = "unknown";
  stats = BodySendStats();

  const auto finish = [&](BodySendOutcome outcome, const char *why) -> BodySendOutcome {
    const uint32_t nowMs = millis();
    stats.totalMs = nowMs - startMs;
    stats.sinceLastWriteMs = nowMs - lastProgressMs;
    if (stats.sinceLastWriteMs > stats.longestNoProgressMs) {
      stats.longestNoProgressMs = stats.sinceLastWriteMs;
    }
    reason = why;
    return outcome;
  };

  while (bytesWritten < length) {
    const uint32_t nowMs = millis();
    const uint32_t sinceProgressMs = nowMs - lastProgressMs;
    if (sinceProgressMs > stats.longestNoProgressMs) {
      stats.longestNoProgressMs = sinceProgressMs;
    }

    if (!client.connected()) {
      return finish(BodySendOutcome::Disconnect, "client disconnected during body write");
    }
    if (sinceProgressMs >= RESPONSE_WRITE_STALL_MS) {
      return finish(BodySendOutcome::Stall, "no successful body write within stall deadline");
    }
    if (nowMs - startMs >= TEMP_DIAGNOSTIC_RESPONSE_LIMIT_MS) {
      return finish(BodySendOutcome::Timeout, "TEMPORARY DIAGNOSTIC absolute body-send deadline exceeded");
    }

    const size_t remaining = length - bytesWritten;
    const size_t chunk = (remaining > RESPONSE_WRITE_CHUNK_BYTES)
                           ? RESPONSE_WRITE_CHUNK_BYTES
                           : remaining;
    const size_t writtenNow = client.write(data + bytesWritten, chunk);
    stats.writeCalls += 1;

    if (writtenNow > 0) {
      if (writtenNow < chunk) {
        stats.shortWrites += 1;
      }
      bytesWritten += writtenNow;
      if (bytesWritten > length) {
        bytesWritten = length;
      }
      lastProgressMs = millis();

      if (bytesWritten >= nextProgressLog && bytesWritten < length) {
        Serial.print(F("Response progress: "));
        Serial.print(bytesWritten);
        Serial.print(F(" / "));
        Serial.print(length);
        Serial.print(F(" bytes in "));
        Serial.print(millis() - startMs);
        Serial.println(F(" ms"));
        while (nextProgressLog <= bytesWritten && nextProgressLog < length) {
          nextProgressLog += RESPONSE_PROGRESS_LOG_BYTES;
        }
      }
    } else {
      stats.zeroWrites += 1;
      if (!client.connected()) {
        return finish(BodySendOutcome::Disconnect, "client disconnected on zero-byte write");
      }
      reason = "zero-byte write; retrying";
      delay(1);
    }

    /* A slow image transfer must not extend an active hardware test pulse. */
    updateOutputPulses();
    yield();
  }

  return finish(BodySendOutcome::Complete, "complete");
}

static const char *bodySendOutcomeName(BodySendOutcome outcome)
{
  switch (outcome) {
    case BodySendOutcome::Complete: return "COMPLETE";
    case BodySendOutcome::Timeout: return "TEMPORARY_LIMIT";
    case BodySendOutcome::Stall: return "STALL";
    case BodySendOutcome::Disconnect: return "DISCONNECT";
    default: return "UNKNOWN";
  }
}

static void printBodySendDiagnostics(size_t expectedBytes,
                                     size_t actualBytes,
                                     const BodySendStats &stats,
                                     BodySendOutcome outcome,
                                     const char *reason)
{
  Serial.print(F("Response expected body bytes: "));
  Serial.println(expectedBytes);
  Serial.print(F("Response actual body bytes written: "));
  Serial.println(actualBytes);
  Serial.print(F("Total send duration: "));
  Serial.print(stats.totalMs);
  Serial.println(F(" ms"));
  Serial.print(F("Time since last successful write: "));
  Serial.print(stats.sinceLastWriteMs);
  Serial.println(F(" ms"));
  Serial.print(F("Longest no-progress interval: "));
  Serial.print(stats.longestNoProgressMs);
  Serial.println(F(" ms"));
  Serial.print(F("Write calls: "));
  Serial.println(stats.writeCalls);
  Serial.print(F("Short writes: "));
  Serial.println(stats.shortWrites);
  Serial.print(F("Zero-byte writes: "));
  Serial.println(stats.zeroWrites);
  if (stats.totalMs > 0) {
    const unsigned long rate = (static_cast<unsigned long>(actualBytes) * 1000UL) / stats.totalMs;
    Serial.print(F("Measured body throughput: "));
    Serial.print(rate);
    Serial.println(F(" bytes/s (not camera FPS)"));
  }
  Serial.print(F("Send result: "));
  Serial.print(bodySendOutcomeName(outcome));
  Serial.print(F("; reason: "));
  Serial.println(reason);
}

/* Sends one converted payload and frees it on every exit path. */
static void sendImagePayload(NetworkClient &client,
                             const char *formatName,
                             const char *mimeType,
                             const char *sourceDescription,
                             uint8_t *payload,
                             size_t payloadLen,
                             uint32_t captureElapsedUs,
                             uint32_t conversionElapsedMs)
{
  Serial.println();
  Serial.print(F("=== "));
  Serial.print(formatName);
  Serial.println(F(" payload response ==="));
  Serial.print(F("Image format: "));
  Serial.println(formatName);
  Serial.print(F("Conversion source: "));
  Serial.println(sourceDescription);
  Serial.print(F("Conversion time: "));
  Serial.print(conversionElapsedMs);
  Serial.println(F(" ms"));
  Serial.print(F("Conversion payload size: "));
  Serial.println(payloadLen);

  server.setContentLength(payloadLen);
  server.sendHeader(F("Cache-Control"), F("no-store"));
  addCorsHeaders();
  server.sendHeader(F("X-Image-Format"), String(formatName));
  server.sendHeader(F("X-Image-Source"), String(sourceDescription));
  server.sendHeader(F("X-Server-Frame"), String(captureRequestCount));
  server.sendHeader(F("X-Capture-Latency-Us"), String(captureElapsedUs));
  server.sendHeader(F("X-Conversion-Ms"), String(conversionElapsedMs));
  server.sendHeader(F("X-Body-Bytes"), String(payloadLen));
  server.sendHeader(F("X-Last-Body-Send-Ms"), String(lastBodySendMs));
  server.sendHeader(F("X-Wifi-Sleep-Enabled"), String(wifiSleepEnabledAfterSetup));
  server.send(200, mimeType, "");

  Serial.println(F("Response headers sent."));
  Serial.print(F("Response Content-Length: "));
  Serial.println(payloadLen);
  Serial.print(F("Response body bytes declared: "));
  Serial.println(payloadLen);

  if (!client.connected()) {
    Serial.println(F("Client disconnected after headers; body not written."));
    free(payload);
    Serial.println(F("=== payload response FAILED: response not sent ==="));
    return;
  }

  size_t actualBodyBytes = 0;
  BodySendStats sendStats;
  const char *sendReason = "unknown";
  const BodySendOutcome outcome = writeBodyFully(
    client,
    payload,
    payloadLen,
    actualBodyBytes,
    sendStats,
    sendReason
  );

  lastBodySendMs = sendStats.totalMs;
  printBodySendDiagnostics(payloadLen, actualBodyBytes, sendStats, outcome, sendReason);

  const bool postWriteConnected = client.connected();
  Serial.print(F("Post-write connected state: "));
  Serial.println(postWriteConnected ? F("connected") : F("not connected"));
  Serial.println(F("Post-write state is not used to declare success; byte accounting is authoritative."));

  free(payload);

  if (outcome != BodySendOutcome::Complete || actualBodyBytes != payloadLen) {
    client.stop();
    Serial.println(F("Payload response FAILED: response body incomplete; no success reported."));
    Serial.println(F("=== payload response FAILED ==="));
    return;
  }

  Serial.print(formatName);
  Serial.println(F(" response COMPLETE: all declared body bytes were written."));
  Serial.println(F("Browser display is NOT confirmed by server-side completion."));
  Serial.print(F("Post-send free heap: "));
  Serial.println(static_cast<unsigned long>(ESP.getFreeHeap()));
  if (psramFound()) {
    Serial.print(F("Post-send PSRAM free: "));
    Serial.println(static_cast<unsigned long>(ESP.getFreePsram()));
  }
  Serial.println(F("=== end payload response ==="));
}

/* Captures and validates one RGB565 frame; caller owns the returned framebuffer. */
static camera_fb_t *acquireValidFrame(uint32_t &captureElapsedUs)
{
  if (!server.client().connected()) {
    Serial.println(F("Client disconnected before capture; no buffers acquired."));
    return nullptr;
  }

  const uint32_t captureStartUs = micros();
  camera_fb_t *fb = esp_camera_fb_get();
  captureElapsedUs = micros() - captureStartUs;

  Serial.print(F("Framebuffer retrieval latency: "));
  Serial.print(captureElapsedUs);
  Serial.println(F(" us (capture latency only; not FPS)"));

  if (fb == nullptr) {
    Serial.println(F("Capture FAILED: no framebuffer returned."));
    sendText(500, "Capture failed: no camera framebuffer returned.");
    return nullptr;
  }

  if (!server.client().connected()) {
    Serial.println(F("Client disconnected during capture; framebuffer returned without conversion."));
    esp_camera_fb_return(fb);
    return nullptr;
  }

  bool metadataValid = true;
  if (fb->width != FRAME_WIDTH || fb->height != FRAME_HEIGHT) {
    metadataValid = false;
    Serial.print(F("Unexpected dimensions: "));
    Serial.print(fb->width);
    Serial.print(F("x"));
    Serial.println(fb->height);
  }
  if (fb->format != PIXFORMAT_RGB565) {
    metadataValid = false;
    Serial.println(F("Unexpected format: not PIXFORMAT_RGB565"));
  }
  if (fb->len != RGB565_FRAME_BYTES) {
    metadataValid = false;
    Serial.print(F("Unexpected frame length: "));
    Serial.print(fb->len);
    Serial.print(F(" (expected "));
    Serial.print(RGB565_FRAME_BYTES);
    Serial.println(F(")"));
  }

  if (!metadataValid) {
    Serial.println(F("Capture FAILED: metadata validation."));
    esp_camera_fb_return(fb);
    sendText(500, "capture metadata did not match RGB565 QVGA");
    return nullptr;
  }

  return fb;
}

static void handleCapture()
{
  CaptureGuard guard(captureBusy);
  if (!guard.owned()) {
    Serial.println(F("Capture rejected: another capture is in progress."));
    sendText(503, "Another capture is in progress.");
    return;
  }

  ++captureRequestCount;

  Serial.println();
  Serial.print(F("=== BMP capture request #"));
  Serial.print(captureRequestCount);
  Serial.println(F(" ==="));
  Serial.print(F("Request start: client "));
  Serial.print(server.client().remoteIP());
  Serial.print(F(":"));
  Serial.println(server.client().remotePort());
  Serial.print(F("RSSI at request start: "));
  Serial.print(WiFi.RSSI());
  Serial.println(F(" dBm"));

  uint32_t captureElapsedUs = 0;
  camera_fb_t *fb = acquireValidFrame(captureElapsedUs);
  if (fb == nullptr) {
    Serial.println(F("=== BMP capture request FAILED ==="));
    return;
  }

  uint8_t *bmp = nullptr;
  size_t bmpLen = 0;
  const char *validationReason = nullptr;

  const uint32_t conversionStartMs = millis();
  const bool converted = frame2bmp(fb, &bmp, &bmpLen);
  const uint32_t conversionElapsedMs = millis() - conversionStartMs;

  Serial.print(F("BMP conversion result: "));
  Serial.println(converted ? F("true") : F("false"));
  Serial.print(F("BMP conversion latency: "));
  Serial.print(conversionElapsedMs);
  Serial.println(F(" ms"));
  Serial.print(F("BMP length: "));
  Serial.print(bmpLen);
  Serial.println(F(" bytes"));

  if (!converted || bmp == nullptr) {
    validationReason = "Espressif frame2bmp() conversion failed";
  } else if (bmpLen != BMP_FRAME_BYTES) {
    validationReason = "BMP length is not the expected 230454 bytes";
  } else {
    validationReason = validateBmpHeader(bmp, bmpLen);
    if (validationReason == nullptr) {
      const size_t middlePixel = (fb->len / 2U) / 2U;
      validationReason = validateRgb565PixelAt(fb->buf, 0, bmp, BMP_HEADER_BYTES);
      if (validationReason == nullptr) {
        validationReason = validateRgb565PixelAt(
          fb->buf,
          middlePixel * 2U,
          bmp,
          BMP_HEADER_BYTES + middlePixel * 3U
        );
      }
      if (validationReason == nullptr) {
        Serial.println(F("BMP header verification: PASS"));
        Serial.println(F("RGB565 byte-order verification: PASS"));
      }
    }
  }

  if (validationReason != nullptr) {
    Serial.print(F("BMP validation FAILED: "));
    Serial.println(validationReason);
  }

  esp_camera_fb_return(fb);
  fb = nullptr;

  if (!server.client().connected()) {
    Serial.println(F("Client disconnected before response; BMP buffer released without sending."));
    if (bmp != nullptr) {
      free(bmp);
    }
    Serial.println(F("=== BMP capture request FAILED ==="));
    return;
  }

  if (validationReason != nullptr) {
    if (bmp != nullptr) {
      free(bmp);
    }
    sendText(500, validationReason);
    Serial.println(F("=== BMP capture request FAILED ==="));
    return;
  }

  sendImagePayload(
    server.client(),
    "BMP",
    "image/bmp",
    "GC2145 RGB565 -> Espressif frame2bmp",
    bmp,
    bmpLen,
    captureElapsedUs,
    conversionElapsedMs
  );
}

static void handleCaptureJpeg()
{
  CaptureGuard guard(captureBusy);
  if (!guard.owned()) {
    Serial.println(F("Capture rejected: another capture is in progress."));
    sendText(503, "Another capture is in progress.");
    return;
  }

  ++captureRequestCount;

  Serial.println();
  Serial.print(F("=== JPEG capture request #"));
  Serial.print(captureRequestCount);
  Serial.println(F(" ==="));
  Serial.print(F("Request start: client "));
  Serial.print(server.client().remoteIP());
  Serial.print(F(":"));
  Serial.println(server.client().remotePort());
  Serial.print(F("RSSI at request start: "));
  Serial.print(WiFi.RSSI());
  Serial.println(F(" dBm"));
  Serial.print(F("Software JPEG quality: "));
  Serial.println(SOFTWARE_JPEG_QUALITY);
  Serial.println(F("Sensor PIXFORMAT_JPEG is not requested."));

  uint32_t captureElapsedUs = 0;
  camera_fb_t *fb = acquireValidFrame(captureElapsedUs);
  if (fb == nullptr) {
    Serial.println(F("=== JPEG capture request FAILED ==="));
    return;
  }

  uint8_t *jpeg = nullptr;
  size_t jpegLen = 0;
  const char *validationReason = nullptr;

  const uint32_t conversionStartMs = millis();
  const bool converted = frame2jpg(fb, SOFTWARE_JPEG_QUALITY, &jpeg, &jpegLen);
  const uint32_t conversionElapsedMs = millis() - conversionStartMs;

  Serial.print(F("JPEG conversion result: "));
  Serial.println(converted ? F("true") : F("false"));
  Serial.print(F("JPEG conversion latency: "));
  Serial.print(conversionElapsedMs);
  Serial.println(F(" ms"));
  Serial.print(F("JPEG payload length: "));
  Serial.print(jpegLen);
  Serial.println(F(" bytes"));

  if (!converted || jpeg == nullptr) {
    validationReason = "Espressif frame2jpg() conversion failed";
  } else if (jpegLen < 4U) {
    validationReason = "JPEG payload is shorter than 4 bytes";
  } else {
    validationReason = validateJpegMarkers(jpeg, jpegLen);
    if (validationReason == nullptr) {
      Serial.println(F("JPEG SOI/EOI marker verification: PASS"));
    }
  }

  if (validationReason != nullptr) {
    Serial.print(F("JPEG validation FAILED: "));
    Serial.println(validationReason);
  }

  esp_camera_fb_return(fb);
  fb = nullptr;

  if (!server.client().connected()) {
    Serial.println(F("Client disconnected before response; JPEG buffer released without sending."));
    if (jpeg != nullptr) {
      free(jpeg);
    }
    Serial.println(F("=== JPEG capture request FAILED ==="));
    return;
  }

  if (validationReason != nullptr) {
    if (jpeg != nullptr) {
      free(jpeg);
    }
    sendText(500, validationReason);
    Serial.println(F("=== JPEG capture request FAILED ==="));
    return;
  }

  sendImagePayload(
    server.client(),
    "JPEG",
    "image/jpeg",
    "GC2145 RGB565 -> Espressif frame2jpg (software)",
    jpeg,
    jpegLen,
    captureElapsedUs,
    conversionElapsedMs
  );
}

void setup()
{
  Serial.begin(115200);
  delay(100);

  /*
   * Arduino-ESP32 3.3.12 requires pinMode(OUTPUT) before digitalWrite() is
   * effective. This is the ordering proven by the isolated hardware tests.
   * Both outputs start HIGH/off; no automatic LED or buzzer alert is emitted.
   */
  pinMode(EXTERNAL_LED_PIN, OUTPUT);
  digitalWrite(EXTERNAL_LED_PIN, OUTPUT_OFF_LEVEL);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, OUTPUT_OFF_LEVEL);
  ledPulse = OutputPulse{false, 0, 0};
  buzzerPulse = OutputPulse{false, 0, 0};

  Serial.println(F("Hardware outputs: GPIO13 LED HIGH/off, GPIO14 buzzer HIGH/off."));
  Serial.println(F("No automatic startup sounds; manual tests use bounded LOW pulses."));

  /* Camera bytes were validated as big-endian RGB565 in the BMP path. */
  jpgSetRgb565BE(true);

  printStartupInfo();

  if (!initializeCameraOnce()) {
    Serial.println(F("Preview setup aborted. No Wi-Fi or web server started."));
    Serial.println(F("=== Camera preview finished ==="));
    return;
  }

  if (!connectToWiFi()) {
    Serial.println(F("Preview setup aborted. Web server not started."));
    printDeinitResult(esp_camera_deinit());
    Serial.println(F("=== Camera preview finished ==="));
    return;
  }

  server.on(F("/"), HTTP_GET, handleRoot);
  server.on(F("/version"), HTTP_GET, handleVersion);
  server.on(F("/version"), HTTP_OPTIONS, handleOptions);
  server.on(F("/capture"), HTTP_GET, handleCapture);
  server.on(F("/capture"), HTTP_OPTIONS, handleOptions);
  server.on(F("/capture_jpeg"), HTTP_GET, handleCaptureJpeg);
  server.on(F("/capture_jpeg"), HTTP_OPTIONS, handleOptions);
  server.on(F("/jpeg"), HTTP_GET, handleCaptureJpeg);
  server.on(F("/jpeg"), HTTP_OPTIONS, handleOptions);
  server.on(F("/led_test"), HTTP_GET, handleLedTest);
  server.on(F("/led_test"), HTTP_OPTIONS, handleOptions);
  server.on(F("/buzzer_test"), HTTP_GET, handleBuzzerTest);
  server.on(F("/buzzer_test"), HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
  server.begin();

  Serial.println(F("=== Preview server ready ==="));
  Serial.print(F("Firmware build: "));
  Serial.println(FIRMWARE_BUILD_ID);
  Serial.print(F("Version endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/version"));
  Serial.print(F("Open: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/"));
  Serial.print(F("BMP diagnostic endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/capture"));
  Serial.print(F("Software JPEG endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/capture_jpeg"));
  Serial.print(F("LED test endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/led_test"));
  Serial.print(F("Buzzer test endpoint: http://"));
  Serial.print(WiFi.localIP());
  Serial.println(F("/buzzer_test"));
  Serial.println(F("Page format selector defaults to JPEG; BMP remains available for diagnostics."));
  Serial.println(F("Firmware captures only when an endpoint is requested; no server push stream."));
  Serial.println(F("=== end preview server ready ==="));
}

void loop()
{
  server.handleClient();
  updateOutputPulses();
  yield();
}
