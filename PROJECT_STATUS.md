# Project Status

Last updated: 2026-11-22

## Current stopping point

The project now supports a portable two-laptop demo. One USB firmware upload turns the ESP32 into a camera-free LED/buzzer device that speaks a versioned newline protocol over Web Serial. The deployed HTTPS web app can then use any laptop's external webcam, ask for explicit browser camera/serial permission, verify the device handshake, calibrate locally, and monitor—without Arduino IDE, firmware upload, a local server, or ESP32 Wi-Fi setup on the second laptop.

The original Wi-Fi alert-controller mode remains as a fallback for local HTTP development. The external webcam remains the only monitoring camera source. Camera tracking, closure episodes, history, browser sound, EAR thresholds, freshness handling, rearming, and one alert per episode are unchanged. Calibration is now one session-only flow that collects eye and relaxed-mouth baselines together.

A leased escalation exists in the USB firmware and browser controller, but it is **disabled at runtime in this GitHub/Vercel release** because its five-second cadence has not been physically accepted. `USB_ESCALATION_RELEASE_ENABLED` is `false`, so no `ESCALATE` command is sent and only the original one-shot LED/buzzer alert runs. The ESP32 firmware is unchanged by this release gate.

Backups of working versions were created before these changes:

- `/Users/aabldeuelm/Desktop/DriverDrowsinessDetection-pre-usb-serial-backup-2026-11-22.tar.gz`
- `/Users/aabldeuelm/Desktop/DriverDrowsinessDetection-pre-escalation-backup-2026-11-22.tar.gz`

The updated USB firmware has been compiled but not uploaded automatically. The deployed web app has been built but not published.

## Current architecture

### Camera and vision

- `CameraProvider` wraps only `useDeviceCamera()`. Monitoring starts with **Start camera** → browser permission → **Available camera** selection.
- The built-in camera or a connected USB webcam is selected after the stream is live. Switching inputs stops only the local stream and invalidates tracking/calibration through a new camera key.
- Camera status, resolution, tracking source, and episode `cameraSource` remain webcam-only.
- `esp32-cam` remains only as a legacy history label/filter.

### Alert transports

- Transport selection is session-only: **USB serial alert controller (portable)** or **Wi-Fi alert controller (fallback)**.
- Wi-Fi mode uses the existing explicit `http(s)://<host>/` URL and derives `/led_test` and `/buzzer_test`. It is intended for local HTTP development; a plain-HTTP ESP32 cannot be fetched from an HTTPS page because of mixed-content rules.
- USB mode uses `navigator.serial.requestPort()` only after an explicit user click. The app opens the port at 115200 baud, sends `DDD1|HELLO|<id>`, and must receive an ACK identifying `usb-serial-alert-controller`, protocol `1`, and both `led,buzzer` outputs before the session toggle can be enabled.
- The Wi-Fi URL and hardware toggle are not persisted. The Web Serial connection is owned by the page session and is closed on explicit disconnect; the browser also releases it when the page closes.
- Manual **Test hardware alert** works without the toggle or a live camera, but still requires a configured Wi-Fi URL or a verified USB connection.
- Episode-triggered alerts still require a live `this-device` stream, the same camera key, the session toggle, and a ready selected transport.
- The HELLO ACK advertises `features=escalation`; this confirms firmware capability only. The release gate is off, so the app never starts escalation even when that feature is present. Basic alerts still work with older firmware.

### Leased escalation (USB only, disabled in this release)

- **Release state:** `USB_ESCALATION_RELEASE_ENABLED = false`. The controller is compiled and unit-tested but is reset on every state update, so this release emits no `ESCALATE|START`, `RENEW`, or `STOP` command and makes no firmware change.
- The initial alert at the configured prolonged-closure threshold is unchanged. In a later enabled build, continuous bilateral closure reaching `5000` ms would send one `DDD1|ESCALATE|id|START` and then `DDD1|ESCALATE|id|RENEW` every `300` ms, each with a fresh ID and a `700` ms ACK timeout.
- The firmware retains a `1200` ms lease watchdog. In an enabled build, renewals extend it; if they stop, `loop()` silences the buzzer without a command, and one best-effort `DDD1|ESCALATE|id|STOP` is sent when escalation is no longer valid.
- Only GPIO14 is used for escalation; GPIO13 LED behavior is untouched. The repeating pattern is the same 2 kHz, 50% duty tone used by the one-shot alert, now 500 ms ON / 500 ms OFF.
- In an enabled build, renewal would require fresh inference evidence: `prolonged-closure`, `closureMs >= 5000`, one visible face, running tracking, no stale reason, no interruption reason, active calibration step absent, a live `this-device` camera with an unchanged camera key, the session toggle on, USB transport selected and verified, and `lastInferenceCompletedAtMs` no older than the existing `500` ms closure sample-gap limit. Missing frames would never count as closed eyes.
- In an enabled build, opening the eyes, stopping monitoring/tracking, starting calibration, changing the camera, stale frames, lost face tracking, USB disconnect, toggle-off, transport change, or old firmware would stop renewal immediately and send one best-effort STOP.
- In an enabled build, a stop would be latched until closure evidence actually ends. A USB reconnect or rejected command would not replay the old interval or restart the same physical closure.
- Escalation is intentionally outside `EpisodeRecorder`: no extra browser sound, no extra stored event, and no change to once-per-episode history.

### Command safety and no replay

- Every serial command gets a fresh 40-character ID at send time. No command is stored for retry or replay.
- Firmware keeps a bounded cache of the last 16 IDs and returns `DDD1|NACK|<id>|DUPLICATE` for repeats.
- Browser ACK/NACK parsing is strict: wrong version, malformed fields, wrong device identity, missing outputs, and unknown ACK IDs are ignored or rejected.
- USB commands are one-shot, bounded by a 2500 ms timeout, and sent with sequential writer access. Manual tests and new episodes supersede in-flight commands.
- Wi-Fi commands remain sequential one-shot CORS-safe GETs with a 2500 ms timeout and no retry.
- Transport changes, toggle-off, URL changes, webcam identity changes, USB disconnect, and unmount invalidate in-flight commands. A reconnect gets a new handshake and new command IDs; old alerts are never queued.
- Disconnections and serial errors are shown in the alert panel and system status. The UI reports command submission/device acknowledgment only; it never claims physical activation.

## Firmware: USB serial alert controller

File to upload: `firmware/usb_serial_alert_controller/usb_serial_alert_controller.ino`
Build ID: `usb-serial-alert-controller-2026-11-22-v3`
Protocol: `DDD1` newline-delimited ASCII at 115200 baud
**This is the only firmware that needs a one-time update for escalation.** The Wi-Fi fallback sketch is unchanged.

The v3 build fixes a handshake truncation found after the v2 upload: v2 assembled the HELLO fields in a 128-byte buffer, but the fields are 132 bytes, so the browser received `features=escal` and correctly withheld escalation. v3 writes the HELLO fields directly, preserving the exact `features=escalation` token. The browser parser and strict capability check were already correct and were not weakened.

Properties:

- No Wi-Fi, camera, JPEG, PSRAM frame buffer, SD, recording, or frame transfer.
- GPIO13 LED remains active low with a bounded 1000 ms LOW pulse and automatic HIGH/off.
- GPIO14 buzzer remains active low with a nonblocking 2 kHz, 50% duty LEDC square wave for one-shot 1000 ms alerts, then `ledcDetach()` and HIGH/off.
- Escalation reuses that PWM setup with a 500 ms ON / 500 ms OFF toggle in `loop()` and a 1200 ms renewable lease; expiry or STOP forces HIGH/off and releases LEDC. GPIO13 is unaffected.
- Both pins are `pinMode(OUTPUT)` before `digitalWrite()`, both default HIGH/off, and no startup pulse is emitted.
- `loop()` handles serial input, PWM toggling, and `millis()` shutoff with no `delay()` in any alert path.
- Protocol frames:
  - Host → device: `DDD1|COMMAND|ID[|ARG]`
  - `HELLO|id` — device identification handshake; ACK now includes `features=escalation`.
  - `TEST|id|LED|BUZZER|ALL` — one bounded output test.
  - `ESCALATE|id|START|RENEW|STOP` — leased repeating buzzer control.
  - Device → host: `DDD1|ACK|ID|COMMAND[|field=value...]` or `DDD1|NACK|ID|REASON` (`NOT_ACTIVE` for a RENEW without a live lease).
- IDs are 1–40 chars from `[A-Za-z0-9._:-]`. Lines are bounded to 128 printable characters; malformed, non-versioned, unknown, and invalid-target commands never activate outputs.
- Duplicate protection uses a fixed 16-ID ring. No dynamic command queue exists.
- Wiring and 3.3 V buzzer supply are unchanged.

Compile command used:

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" \
  compile \
  --fqbn "esp32:esp32:esp32:UploadSpeed=115200,CPUFreq=240,FlashFreq=40,FlashMode=dio,FlashSize=4M,PartitionScheme=default,PSRAM=enabled,JTAGAdapter=default,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none" \
  firmware/usb_serial_alert_controller
```

Result: `315963` bytes flash (`24%`), `24308` bytes RAM (`7%`). Compiled only; not uploaded.

The installed core reported by the CLI here is `esp32:esp32 4.0.0`; the sketch uses the same `ledcAttach`/`ledcWrite`/`ledcDetach` API available in Arduino-ESP32 3.3.12.

## Firmware: Wi-Fi fallback (unchanged)

`firmware/alert_controller/alert_controller.ino` remains the camera-free HTTP alert device:

- Build ID: `alert_controller-2026-11-22-2khz-v2`
- Endpoints: `/version`, `/led_test`, `/buzzer_test`, root page, and OPTIONS/CORS handlers.
- GPIO13 LOW pulse and GPIO14 2 kHz LEDC waveform remain bounded to 1000 ms with automatic HIGH/off.
- Wi-Fi credentials remain only in local `firmware/alert_controller/secrets.h`; `secrets.example.h` is the template. No credentials are in source, docs, the web bundle, or backups.

## Web app preparation for HTTPS deployment

- Added `HardwareAlertPanel` with transport selection, Wi-Fi URL input, USB connect/disconnect, handshake state, device/build display, unsupported-browser message, session toggle, manual test, and visible status.
- Added `usbSerialAlert.ts` with protocol framing, strict ACK/NACK parsing, handshake/feature verification, unique command IDs, bounded requests, explicit disconnect cleanup, one-shot escalation commands, and no retry queue.
- Added `usbEscalationController.ts` with fresh-closure validation, lease renewal, immediate stop/latch behavior, and no history/audio side effects.
- `AlertsContext` gates the session toggle behind the selected transport's readiness. USB readiness requires a verified handshake. In a future enabled build, escalation would additionally require the advertised feature and continuously fresh closure evidence; this release resets the controller on every update.
- `SystemStatusPanel`, `LiveMonitoringScreen`, `DevicesHardwareScreen`, and the footer now report the selected transport instead of assuming Wi-Fi.
- Vite now uses relative asset URLs (`base: './'`) so `dist/` can be served from a domain root or subpath.
- Deployment notes are in `docs/https-deployment.md`. The app is **prepared but not published**.
- The built `dist/` uses relative `./assets/...` paths and contains no app-owned localhost dependency, firmware secrets, or local-server requirement.

## Checks run and actual results

From `apps/admin`:

```text
npm run check
TypeScript typecheck: passed
Vitest: 13 test files passed, 114 tests passed
Vite production build: passed
1699 modules transformed
```

The tests cover serial framing/validation, ESCALATE encoding, handshake/feature verification including wrong-device rejection, the exact v3 firmware HELLO ACK, strict rejection of the truncated v2 feature token, 115200 baud opening, one-shot TEST and escalation acknowledgments, NACK reporting without retry, cancellation on disconnect, and no command replay after reconnect. Escalation tests cover the disabled release gate, 5-second gating, periodic renewal, every stop condition, missing-frame rejection, rejected renewal, and reconnect latching.

Firmware compilation passed for `firmware/usb_serial_alert_controller`. No upload was performed by the assistant.

No browser E2E suite was run. Physical USB-serial behavior on a second laptop remains to be accepted by the user. The previously reported Wi-Fi/external-webcam physical results are recorded below and remain unchanged.

## Repository and Vercel preparation

- Target remote: `https://github.com/aabldeuelm-ux/Driver-drowsiness-detection-system.git`
- Target branch: `main` (the remote was empty before the first push, so no force push is needed).
- Staged files were checked: no `secrets.h`, `.env` override, `node_modules`, `dist`, backup archive, or local secret value is included. Safe `.env.example` and `*.example.h` templates are included.
- Vercel root directory: `apps/admin`; build command: `npm run build`; output directory: `dist`; no environment variables.
- No SPA rewrite is needed. The production `index.html` uses relative `./assets/...` URLs.
- The pinned MediaPipe WASM fileset and Face Landmarker model URLs were checked over HTTPS and returned HTTP 200. No publishing is performed by this repository; the Vercel dashboard must still complete the deployment.

## One-time USB firmware update (already prepared; unchanged by this release gate)

```text
firmware/usb_serial_alert_controller/usb_serial_alert_controller.ino
```

This is the **only firmware that has ever needed re-flashing**; build `usb-serial-alert-controller-2026-11-22-v3` fixes the v2 handshake truncation. This GitHub/Vercel release does **not** modify or require new firmware: the escalation feature remains compiled into v3 but is disabled in the browser. A browser refresh alone cannot fix a v2 device. The Wi-Fi fallback firmware is unchanged. Do not change wiring or supply voltage. Choose **ESP32 Dev Module**, upload speed `115200`, and the serial port for the board. If the upload reports `No serial data received`, hold BOOT while starting the upload, release when transfer begins, and press RESET afterward if needed.

## Short two-laptop acceptance test

1. **One time, Laptop A:** if not already done, upload v3 `firmware/usb_serial_alert_controller/usb_serial_alert_controller.ino`. This release does not change firmware. Keep the webcam and ESP32 connected by USB; do not change wiring.
2. **Laptop A:** open the deployed HTTPS URL in desktop Chrome, grant camera permission, select the external webcam, start tracking, and complete calibration. Choose **USB serial alert controller (portable)**, click **Connect USB alert device**, choose the ESP32 serial port, and wait for handshake verification. The panel should state that five-second escalation is disabled in this release.
3. **Laptop A one-shot alert:** click **Test hardware alert**; confirm command acknowledgment and physically confirm one LED flash plus one audible 2 kHz chirp with automatic shutoff. Enable the session toggle, close both eyes past the threshold, reopen, and confirm one browser sound, one stored event, and one LED/buzzer alert per episode. Stop monitoring and confirm no further alerts.
4. **Laptop A escalation gate:** close both eyes continuously for more than 5 seconds. Confirm there is no repeating tone and no extra history event; only the original one-shot alert occurs. This proves the release gate is active.
5. **Laptop A interruptions:** repeat a closure, then stop monitoring, start calibration, lose face tracking, and unplug USB one at a time. Confirm no repeating tone starts in any case and no old alert replays after reconnecting.
6. **Laptop B:** move the webcam and ESP32, open the same HTTPS URL in desktop Chrome, grant camera and serial permissions, select the external webcam, and calibrate independently in that browser session.
7. **Laptop B:** connect and verify the USB device, run the manual test, enable the session toggle, and repeat one closure/rearm/stop cycle plus the no-escalation check. Disconnect and reconnect the USB device; confirm the app shows the disconnection, requires a new handshake, and does not replay any old alert.
8. No Arduino IDE, firmware upload, local server, or ESP32 Wi-Fi setup should be needed on Laptop B.

## Relevant files

- `README.md` — repository landing page and quick start.
- `.gitignore` — excludes secrets, dependencies, build output, backups, and local files.
- `apps/admin/vercel.json` — Vercel build/output settings for the app root.
- `docs/vercel-deployment.md` — exact Vercel import and verification steps.
- `firmware/usb_serial_alert_controller/usb_serial_alert_controller.ino` — new portable alert firmware.
- `firmware/alert_controller/alert_controller.ino` — unchanged Wi-Fi fallback firmware.
- `apps/admin/src/alerts/usbSerialAlert.ts` — Web Serial transport, protocol parser, and escalation command API.
- `apps/admin/src/alerts/usbEscalationController.ts` — leased escalation validation, renewal, stop latching, and the release-off gate.
- `apps/admin/src/alerts/__tests__/usbSerialAlert.test.ts` — serial transport and escalation framing regressions.
- `apps/admin/src/alerts/__tests__/usbEscalationController.test.ts` — escalation lifecycle regressions.
- `apps/admin/src/alerts/AlertsContext.tsx` — transport-selected, handshake-gated alert submission, escalation wiring, and invalidation.
- `apps/admin/src/components/HardwareAlertPanel.tsx` — shared transport/connection/test UI.
- `apps/admin/src/components/LiveMonitoringScreen.tsx`, `DevicesHardwareScreen.tsx`, `SystemStatusPanel.tsx`, `App.tsx` — transport-aware status/copy.
- `apps/admin/src/camera/deviceCameraController.ts` — secure-context message no longer names localhost.
- `apps/admin/vite.config.ts` — relative base for static HTTPS hosting.
- `docs/https-deployment.md` — deployment preparation and browser requirements.
- `apps/admin/README.md` — local commands and deployment pointer.
- `PROJECT_STATUS.md` — this record.

## Historical verification summary

- The user previously reported full physical end-to-end success with the external webcam and Wi-Fi alert controller using `alert_controller-2026-11-22-2khz-v2`: browser sound, GPIO13 LED, audible GPIO14 buzzer, one alert per prolonged-closure episode, rearming after reopening, and no alerts after stopping monitoring.
- The isolated buzzer/LED sketch passed the physical bench test after fixing `pinMode(OUTPUT)` ordering. GPIO13 LED is wired as `3V3 → 1 kΩ → LED anode → LED cathode → GPIO13` (active low). GPIO14 drives the low-level-trigger buzzer module with VCC at 3.3 V and common ground.
- GC2145 RGB565 QVGA `320x240` constraints apply only to legacy `camera_preview`, not to either alert controller.
- Earlier Safari manual results confirmed test sound, normal blinks not alerting, one sound/event per prolonged-closure episode, rearming after reopening, no alerts after stopping monitoring, settings/history surviving reload, calibration resetting, and JSON/CSV downloads.
- No Git repository is present. Changes remain uncommitted. No Wi-Fi credentials were copied into documentation, source, the web bundle, or backups.

## Known unverified behavior

- The updated USB serial firmware (v3) has been compiled but not uploaded by the assistant. The user previously uploaded v2, which reports the new build ID but truncates the escalation feature token.
- Physical USB-serial one-shot alerts and the two-laptop move have not yet been user-accepted in this release. Five-second escalation timing/audibility remains intentionally unverified and runtime-disabled, so it is not part of the acceptance criteria.
- Web Serial is desktop Chrome/Edge only; other browsers show the unsupported message and can still use Wi-Fi mode where mixed content permits it.
- Other cameras, networks, boards, and browsers have not been individually validated.
- Real-browser camera switching, overlay alignment, calibration under target lighting, threshold stability, IndexedDB edge cases, and interruption edge cases still need focused manual verification.
- Numbered face selection, reselect-after-loss behavior, one-click eye and relaxed-mouth calibration, normal blinking and talking not resetting calibration progress, face-change invalidation, brief-versus-sustained mouth opening, pop-up readability/dismissal, and eye/yawn sound non-overlap still need focused webcam verification.
- The vibration motor remains disabled. Do not connect it directly to a GPIO. The new yawn alert is browser-only and never routes to ESP32 hardware.
- Drowsiness classification, severity escalation, and confirmed-yawn classification remain out of scope and must not be implied by current labels.

## Exact commands

```bash
cd /Users/aabldeuelm/Desktop/DriverDrowsinessDetection/apps/admin
npm run dev        # local HTTP development only
npm run typecheck
npm run test
npm run build
npm run check
```
