# Driver Drowsiness Detection System — Project Plan

Status: planning only. No application code, firmware, or wiring instructions are part of this document.

Date: 2026-11-18

## 1. Purpose and scope

Build a local-first, responsive web system that monitors a driver for:

- Prolonged eye closure.
- Possible yawning.
- Monitoring problems such as missing face, poor lighting, unavailable camera, frozen video, or low frame rate.

The system must never interpret missing or degraded input as “driver awake.” If the software cannot see enough reliable video, it enters a **monitoring problem** state and alerts accordingly.

The project will be delivered incrementally:

1. **Admin software** — configuration, calibration, diagnostics, event history, export/delete, and shared detection core.
2. **ESP32 camera and alert integration** — camera streaming from the ESP32-CAM and later output control only after electrical validation.
3. **User software** — simplified monitoring UI built on the same core.

This is an assistance tool, not a certified safety device. Acceptance criteria are functional and engineering criteria, not medical or regulatory certification.

---

## 2. Core design principles

1. **Process video on the MacBook or phone, never on the ESP32.**  
   The ESP32 only captures and transports frames. All face detection, landmark analysis, drowsiness classification, and alert decisions happen in the browser.

2. **Fail safe on uncertainty.**  
   Missing face, poor lighting, frozen frames, denied camera access, disconnected ESP32, or low confidence are monitoring problems. They are never reported as “awake.”

3. **Local-first.**  
   IndexedDB is the default system of record. No paid cloud database is required. Cloud accounts and shared databases can be added later through repository interfaces.

4. **No raw video or face images by default.**  
   Only numeric features, thresholds, settings, event metadata, and optional calibration summaries are stored. Debug image capture must be off by default and, if ever added, explicitly opt-in.

5. **Hardware outputs are disabled by default.**  
   Browser alerts are primary in early phases. Hardware alerts are introduced only after the exact board, pinout, voltage, current, and driver requirements are confirmed.

6. **Board-agnostic ESP32 layer.**  
   Do not assume the AI Thinker pinout. Pin mapping and camera format support must be confirmed before firmware or wiring.

---

## 3. Proposed architecture

### 3.1 High-level flow

```text
Camera sources
  ├─ MacBook built-in webcam  ─┐
  ├─ Phone camera             ─┼─> Camera adapters / frame normalizer
  └─ ESP32-CAM stream         ─┘             │
                                             v
                                  Browser vision pipeline
                                  ├─ Face/landmark detection
                                  ├─ Eye closure features
                                  ├─ Mouth/yawn features
                                  ├─ Quality checks
                                  └─ Frame freshness checks
                                             │
                                             v
                                  Drowsiness state machine
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       v                     v                     v
              Browser alerts          Local event log      Optional output controller
              audio/visual            IndexedDB            disabled until validated
```

### 3.2 Major components

| Component | Responsibility |
|---|---|
| Admin app | Configure thresholds, run calibration, inspect diagnostics, review/export/delete settings and events. |
| User app | Simplified session UI: select camera, start/stop monitoring, show alerts and current status. Built later on shared packages. |
| Core domain | Versioned config schema, event types, state machine, rule evaluation, profile model. |
| Vision module | Face landmarks, eye aspect ratio, mouth aspect ratio, brightness/quality checks, frame-freshness checks. |
| Camera adapters | Normalize webcam, phone camera, and ESP32 streams into a common frame interface. |
| Alert manager | Browser audio, visual alerts, optional vibration, escalation, cooldowns. |
| Storage layer | Repository interfaces plus IndexedDB adapter; later API/shared-database adapter. |
| Local gateway | Optional Node service for serving the app over HTTPS and proxying ESP32 streams/control to a same-origin path. |
| Firmware area | Later ESP32-CAM code with board pinout configuration, capture format handling, stream transport, and output-control stubs. |

### 3.3 Runtime states

The state machine should use explicit states rather than a simple “awake/asleep” boolean.

| State | Meaning |
|---|---|
| `IDLE` | Monitoring not started. |
| `CALIBRATING` | Calibration flow in progress; no drowsiness conclusions are produced. |
| `MONITORING` | Valid face and usable video are available; detection rules are active. |
| `EYE_CLOSURE_ALERT` | Prolonged eye closure detected. |
| `POSSIBLE_YAWN_ALERT` | Possible yawn detected; label remains uncertain by design. |
| `MONITORING_PROBLEM` | Missing face, poor lighting, unavailable camera, frozen video, low FPS, hidden tab, or low confidence. |
| `PAUSED` | User explicitly paused monitoring. |

Rules:

- `MONITORING_PROBLEM` overrides `MONITORING`.
- No state means “confirmed awake.” The closest state is `MONITORING`, which only means “input is currently usable and no alert condition is active.”
- Recovery from alerts requires hysteresis: the signal must return to a safe range for a configurable time before the alert is cleared.

### 3.4 Admin vs user software

- **Admin software** is the first build target. It exposes all configuration and diagnostics.
- **User software** will reuse the same core, vision, camera, alert, and storage packages with a simpler UI.
- Admin mode in early versions is a local UI mode, not a security boundary. Authentication and role-based access are future work.

---

## 4. Proposed folder structure

```text
DriverDrowsinessDetection/
├─ PROJECT_PLAN.md
├─ README.md
├─ apps/
│  ├─ admin/                  # Phase 1: admin web app
│  ├─ user/                   # Phase 3: simplified user web app
│  └─ gateway/                # Local HTTPS app server and ESP32 proxy
├─ packages/
│  ├─ core/                   # Config schema, state machine, event/domain types
│  ├─ vision/                 # Landmark processing, EAR/MAR, quality gates
│  ├─ camera/                 # Webcam, phone camera, ESP32 adapters
│  ├─ alerts/                 # Browser alerts and output-controller interface
│  ├─ storage/                # Repository interfaces, IndexedDB adapter, export/import
│  └─ ui/                     # Shared responsive components and theme
├─ firmware/
│  └─ esp32-cam/              # Later: board config, capture, stream, output stubs
├─ docs/
│  ├─ hardware-inventory.md
│  ├─ board-pinout-confirmation.md
│  ├─ gc2145-capture-formats.md
│  ├─ gpio-output-safety.md
│  └─ test-protocols/
├─ tests/
│  ├─ synthetic-signals/
│  ├─ browser-e2e/
│  └─ hardware-checklists/
├─ scripts/
└─ .github/                   # Later, if version control/CI is added
```

This structure is a proposal. Implementation can simplify it, but the separation between domain logic, hardware adapters, storage, and UI should remain.

---

## 5. Camera architecture

### 5.1 Built-in webcam

- Use the browser `getUserMedia` API.
- Requires a secure context: `https://` or `http://localhost`.
- Camera labels may be hidden until the user grants permission.
- Handle permission denial, device removal, track ended, and browser/device busy errors as monitoring problems.

### 5.2 Phone camera

This means the web app is running in the phone browser and uses that phone’s own camera.

- Also uses `getUserMedia`.
- Requires HTTPS. `localhost` on the MacBook does not count as localhost on the phone.
- Support `facingMode` selection where available, but treat it as a hint, not a guarantee.
- Use `playsinline`, muted video, and a user gesture for start; iOS Safari is strict about autoplay and audio.
- Vibration via the Vibration API may work on some Android browsers and is absent on many iOS browsers.

A MacBook selecting a phone as a remote camera is not part of the first implementation. It could be added later with WebRTC pairing, with processing still performed on either the MacBook or the phone.

### 5.3 ESP32-CAM

- The ESP32-CAM streams frames over the local network.
- The MacBook or phone connects to that stream, converts frames into a canvas/`VideoFrame`, and runs all detection locally.
- The ESP32 performs no drowsiness inference.
- Transport encoding, such as software JPEG compression, is allowed only as needed to move frames; it is not the detection step.

Recommended connection modes:

1. **Router/STA mode, preferred:** ESP32 joins the same Wi-Fi network as the MacBook/phone.
2. **ESP32 SoftAP mode, fallback:** MacBook/phone joins the ESP32’s Wi-Fi network. Useful without a router but may disable normal internet access and may be blocked by some mobile browsers.

Address discovery:

- mDNS names such as `esp32-cam.local` are convenient but not reliably supported by all phone browsers.
- Always provide manual IP/host entry.
- Include a connection test that reports reachability, frame rate, resolution, and format.

### 5.4 Camera selector behavior

The selector must show:

- Available source type: built-in webcam, phone camera, ESP32-CAM.
- Permission state.
- Connection state.
- Live frame indicator.
- Resolution and FPS estimate.
- Clear error messages when a source is unavailable.

Selecting a camera must not silently fall back to “awake.” If the chosen source fails, enter `MONITORING_PROBLEM`.

---

## 6. Vision and detection design

### 6.1 Landmark-based features

Initial feature set:

- Eye aspect ratio or equivalent eye-open measure from landmark geometry.
- Mouth aspect ratio or lip-open measure for possible yawning.
- Face presence and landmark confidence.
- Frame brightness and contrast/variance estimate.
- Frame timestamp and frame-to-frame difference to detect frozen or stalled video.

### 6.2 Blink vs sustained closure

A normal blink and a prolonged closure differ mainly in duration and recovery pattern.

Proposed logic:

- calibration establishes an eye-open baseline and a closure threshold per user/camera/lighting profile.
- brief closure below threshold that resolves quickly is classified as a blink.
- closure below threshold for longer than `eyeClosureMs` is a drowsiness alert.
- hysteresis and a minimum recovery time prevent rapid state flicker.
- multiple consecutive valid frames are required before declaring either blink or closure.

Example starting values, subject to calibration and testing:

- Blink: roughly under 200–300 ms.
- Prolonged closure: configurable, initially around 500–800 ms.
- Alert cooldown: configurable, initially several seconds.

These numbers are starting points only. Final values should come from calibration and recorded/synthetic test sequences.

### 6.3 Possible yawning

Yawning is ambiguous from video alone, so the UI should say **possible yawn**, not “confirmed yawn.”

Proposed logic:

- mouth-open measure exceeds a calibrated threshold;
- the opening persists for a configurable duration;
- face and landmark confidence are valid;
- optional eye-closure/head-motion context can reduce false positives;
- cooldown and hysteresis prevent repeated alerts.

### 6.4 Quality and monitoring-problem gates

The following conditions must produce `MONITORING_PROBLEM`, not `MONITORING` or any awake implication:

- No face detected for longer than `missingFaceGraceMs`.
- Landmarks lost or low confidence.
- Too dark, too bright, or low image variance.
- Camera permission denied.
- Selected camera unavailable.
- ESP32 stream disconnected.
- No new frames for longer than `frozenFrameSeconds`.
- Frames are visually identical despite expected motion.
- Effective FPS below `minFps`.
- Browser tab hidden or page not visible.
- Calibration missing or invalid for the selected profile.

Alerts for monitoring problems should use distinct wording, for example: “Monitoring paused: face not visible” rather than “Driver awake.”

---

## 7. Configuration and calibration

### 7.1 Config model

Settings should be versioned and validated. Store them as profiles so different users, cameras, or lighting environments can be compared without raw images.

Config groups:

| Group | Examples |
|---|---|
| Camera | selected source, ESP32 host/port/path, desired resolution, desired FPS |
| Eye detection | closure threshold, closure duration, blink maximum duration, hysteresis, recovery time |
| Yawn detection | mouth-open threshold, duration, cooldown |
| Quality gates | minimum face confidence, brightness range, minimum FPS, frozen-frame seconds, missing-face grace |
| Alerts | sound on/off, volume, visual style, vibration on/off, cooldown, escalation |
| Storage | active profile name, export preferences |
| Hardware | board profile, pin mapping, output enable flags — all disabled until validated |

### 7.2 Calibration flow

1. Confirm secure context and camera permission.
2. Select camera source and verify live frames.
3. Ask the user to position their face naturally.
4. Check brightness, contrast, face confidence, and FPS.
5. Record numeric eye-open baseline in memory.
6. Ask for several normal blinks; estimate blink duration and eye-open range.
7. Optionally ask for an exaggerated yawn to set a mouth-open reference.
8. Compute suggested thresholds from measured values.
9. Show a validation preview with live classification labels.
10. Let the user save, tweak, rename, or discard the profile.
11. Store only numeric baselines and final settings, not face images or video.

Calibration must be cancellable at every stage and must never leave monitoring active with invalid settings.

---

## 8. Alerts

### 8.1 Browser alerts

Primary alerts should work without external hardware:

- Visual banner/card with text and icon; do not rely on color alone.
- Web Audio tone or pattern; require a user gesture such as “Start Monitoring” so browser autoplay policies allow sound.
- Optional `navigator.vibrate` where supported.
- Optional browser notifications, but not as the primary alert because permission and background behavior vary.
- Escalation pattern: first alert, repeated alert after cooldown, stronger alert if condition persists.

Different alert classes:

- Eye closure.
- Possible yawn.
- Monitoring problem.
- Hardware output failure, once hardware alerts exist.

### 8.2 Browser background behavior

When the tab is hidden, timers and animation frames may be throttled. The app must:

- stop treating hidden-tab frames as reliable;
- enter `MONITORING_PROBLEM` or `PAUSED`;
- not claim the driver is awake;
- resume only after visible frames are fresh again.

### 8.3 Hardware alerts

Hardware alerts are out of scope until Phase 4 and require:

- exact board and pin mapping confirmation;
- measured electrical compatibility;
- current and voltage checks;
- explicit output-enable state in config;
- safe default-off behavior on boot;
- a test mode that is manually confirmed.

The vibration motor remains disabled because the listed components do not include a suitable motor driver transistor or MOSFET.

---

## 9. Local-first storage and data handling

### 9.1 Storage technology

- Use IndexedDB for settings, profiles, and event history.
- Use `localStorage` only for very small UI preferences such as last selected theme.
- Use a repository interface so storage can later be replaced or synced with a shared database.

### 9.2 Stored data

Allowed by default:

- Settings and profiles.
- Numeric calibration summaries.
- Event records with timestamps, type, severity, duration, camera source, and threshold snapshot.
- Diagnostic counters such as FPS averages and problem counts.

Not stored by default:

- Video.
- Face images.
- Raw frames.
- Debug snapshots.

### 9.3 Export and delete

The admin UI must support:

- Export all settings and event history as JSON.
- Export event history as CSV.
- Import settings with schema/version validation.
- Delete individual events.
- Delete a profile.
- Delete all locally stored data with confirmation.
- Show approximate storage usage and origin so users understand where data lives.

### 9.4 Limitations

- `localStorage` is small, string-only, and unsuitable for event history.
- IndexedDB quotas vary by browser and device; storage can be evicted under pressure.
- Private/incognito modes may discard data on close.
- Clearing site data deletes local records.
- Browser storage is per origin: `https://admin.example` and `https://user.example` do not share data unless explicitly synced.
- Local storage is not encrypted by the app. Protect the device and browser profile.

### 9.5 Future accounts/shared database

Prepare but do not implement now:

- stable record IDs;
- `createdAt`, `updatedAt`, `deviceId`, `schemaVersion`;
- repository methods that can be backed by IndexedDB now and an API later;
- auth abstraction with anonymous/local identity now;
- conflict policy design, initially last-write-wins per record;
- role separation for admin and user interfaces.

---

## 10. Recommended stack

Use one simple stack for all web work:

| Layer | Choice |
|---|---|
| Build tooling | Vite |
| UI | React + TypeScript |
| Styling | Tailwind CSS |
| Vision | MediaPipe Face Landmarker via `@mediapipe/tasks-vision`, running in the browser |
| Inference execution | Web Worker where practical, with canvas/`VideoFrame` transfer |
| Validation | Zod for versioned config schemas |
| Storage | Dexie/IndexedDB |
| Local service | Node.js + TypeScript + Fastify + `ws` |
| HTTPS for LAN testing | Caddy with a locally trusted certificate, for example via mkcert |
| Tests | Vitest for core logic, Playwright for browser flows |

Why this stack:

1. **TypeScript** reduces mistakes in state machines, config schemas, and event types.
2. **React + Tailwind** makes responsive admin and user UIs fast to build and easy to keep consistent.
3. **MediaPipe Tasks Vision** provides browser-side face landmarks without a cloud service or custom model training in phase 1.
4. **Dexie/IndexedDB** satisfies local-first storage, larger quota than `localStorage`, and straightforward export/delete.
5. **MediaPipe runs on the client**, satisfying the requirement that video processing not happen on the ESP32 or a paid backend.
6. **A small Node gateway** solves same-origin HTTPS and CORS/mixed-content problems for the ESP32 without introducing a database.
7. **Vitest and Playwright** allow blink-vs-closure logic and permission/error flows to be tested before hardware is involved.

No paid database or cloud backend is required.

---

## 11. Browser permissions, HTTPS, and local ESP32 communication

### 11.1 Camera permissions

- `getUserMedia` triggers a browser permission prompt for camera access.
- Permission is granted per origin, not per page, and can be revoked later in browser settings.
- Device names may not appear until permission has been granted.
- Only one app may be able to use a camera at a time on some systems.
- If the browser is embedded in an iframe, a Permissions Policy can block camera access.
- Users must be told why the camera is needed and must explicitly start monitoring.
- Denial, revocation, or track ending is a monitoring problem.

### 11.2 HTTPS requirements on phones

- Browsers require a secure context for `getUserMedia`.
- `https://` is secure. `http://localhost` is secure only on the same device where localhost resolves.
- A MacBook URL like `http://192.168.1.20:5173` is not secure for a phone, so phone camera access will fail.
- An HTTPS page cannot normally load an insecure `http://` ESP32 stream because of mixed-content blocking.
- A public HTTPS page talking directly to a private LAN address can also be blocked by browser Private Network Access rules.

Practical approaches:

1. Serve the app from HTTPS and proxy the ESP32 through the same origin using the local gateway.
2. Use a locally trusted certificate authority on the MacBook and install/trust it on the phone.
3. Use a temporary HTTPS tunnel for development if local certificate trust is inconvenient.
4. Use `http://localhost` on the MacBook for early desktop-only testing.

For phone testing, the plan is to use HTTPS plus a same-origin gateway proxy.

### 11.3 How MacBook/phone communicates with a local ESP32

```text
Phone/MacBook browser
  https://local-origin
        |
        | same-origin /esp/... request
        v
Local gateway on MacBook
  http://ESP32_IP/stream or WebSocket
        |
        v
ESP32-CAM on same Wi-Fi/LAN
```

Benefits:

- avoids mixed content;
- avoids CORS problems;
- allows one stable app origin;
- keeps ESP32 address details behind a configurable gateway route;
- allows future control commands to be gated and logged.

Direct browser-to-ESP32 access is possible only if all browser security constraints are satisfied, including HTTPS/WSS and same-origin or permissive CORS. The gateway is the simpler default.

---

## 12. Hardware inventory and constraints

### 12.1 Available hardware

1. ESP32-CAM with GC2145 camera sensor.
2. ESP32-CAM-MB programmer with Micro-USB, IO0 and RST buttons.
3. USB data cable.
4. Breadboard.
5. Male-to-female jumper wires.
6. Active buzzer module: GND, I/O, VCC.
7. Small DC vibration motor.
8. Red LEDs.
9. Push buttons.
10. 1 kΩ resistors and other unidentified resistor values.
11. 1N4007 diodes.
12. MacBook with Arduino IDE.

### 12.2 Hardware constraints

- Do not assume the ESP32-CAM uses the AI Thinker pinout.
- Confirm the exact board model, connector orientation, and pin mapping before firmware or wiring.
- Confirm whether PSRAM is present; capture buffers and conversion may depend on it.
- The ESP32-CAM-MB is a programmer/USB-UART adapter, not a separate general-purpose development board.
- USB power from the programmer may be insufficient for stable camera operation, especially with added outputs. Do not assume it is adequate.
- GC2145 does not provide native JPEG output like the OV2640. Available formats must be checked in the actual driver/board setup.
- Because GC2145 frames may be RGB565, YUV422, RAW, or another driver-dependent format, the design must include a conversion path to something the browser can render.
- Software JPEG encoding on the ESP32 may be possible but must be tested for RAM, CPU, resolution, and FPS impact.
- Raw binary frames over WebSocket may be simpler in some cases but require browser conversion and may use more bandwidth.
- Do not connect the vibration motor directly to a GPIO. Keep it disabled because there is no listed motor driver transistor/MOSFET.
- Verify buzzer operating voltage, current draw, and input polarity before enabling.
- LEDs require correct current-limiting resistors; the unknown resistor values must be identified first.
- Do not infer resistor values from appearance. Use color bands, a multimeter, or known sourcing records.
- 1N4007 diodes are suitable for certain flyback/protection roles but their use must be designed, not assumed.
- Push buttons need confirmed wiring and pull-up/pull-down behavior; debounce in firmware.
- Software cannot automatically identify passive component values.
- Software cannot prove that a buzzer, LED, or motor physically works. Manual measurement and observation are required.

### 12.3 Hardware work policy

Phase 2 hardware work begins with a checklist:

1. Identify the exact ESP32-CAM board and camera connector.
2. Record pin mapping in `docs/board-pinout-confirmation.md`.
3. Confirm camera format support in `docs/gc2145-capture-formats.md`.
4. Confirm power source and current budget.
5. Confirm buzzer/LED/output compatibility in `docs/gpio-output-safety.md`.
6. Only then write or flash firmware.

No hardware alert output is enabled during camera integration testing.

---

## 13. Implementation phases and acceptance criteria

### Phase 0 — Planning and inventory

Deliverable: this `PROJECT_PLAN.md`.

Acceptance:

- Architecture, folder structure, phases, constraints, and acceptance criteria are documented.
- Hardware questions are listed separately.
- No application code has been written.

### Phase 1 — Admin software and shared core

Deliverables:

- Responsive admin app shell.
- Versioned config/profile model.
- IndexedDB repository with export/import/delete.
- Event history viewer.
- Camera selector UI with graceful error states.
- Browser alert manager.
- Detection state machine with synthetic tests.
- Calibration flow UI and numeric baseline storage.
- Webcam support for MacBook; phone support once HTTPS is configured.

Acceptance:

- Layout works on a 1366×768 MacBook viewport and common phone widths around 360–430 px without horizontal overflow.
- Touch targets are at least approximately 44 px.
- Camera permission denial, missing camera, and track ending produce `MONITORING_PROBLEM`.
- Synthetic blink sequences are not classified as prolonged closure.
- Synthetic sustained closure sequences trigger eye-closure alerts.
- Missing face, low light, low FPS, and frozen frames produce monitoring problems.
- Settings and events can be exported, imported, and deleted.
- No video or face images are stored.

### Phase 2 — ESP32 camera integration

Deliverables:

- Confirmed board pinout and camera format documentation.
- Firmware that captures and streams frames without drowsiness inference.
- Local gateway route for ESP32 video and connection diagnostics.
- ESP32 option in the camera selector.
- Frame conversion and quality checks for ESP32 streams.
- Documentation of measured resolution, FPS, latency, and failure modes.

Acceptance:

- Pinout is confirmed before firmware/wiring; no AI Thinker assumption is present.
- GC2145 capture format and conversion path are documented.
- Browser receives usable frames through the same-origin HTTPS route.
- Detection still runs only in the browser.
- Disconnection, stalled frames, and poor stream quality become monitoring problems.
- No buzzer, motor, or other hardware output is enabled.

### Phase 3 — User software

Deliverables:

- Simplified responsive user monitoring UI.
- Reuse of core, vision, camera, alerts, and storage packages.
- Guided first-run setup and calibration.
- Clear start/stop monitoring flow.
- Profile selection and basic event review/export/delete.

Acceptance:

- A non-admin user can select a camera, calibrate, start monitoring, and understand alerts without configuration jargon.
- All monitoring problems are visibly distinct from normal monitoring.
- Phone and MacBook layouts remain responsive.
- User and admin apps use the same underlying state machine and thresholds.

### Phase 4 — Hardware alerts after validation

Deliverables:

- Hardware output abstraction with safe default-off behavior.
- Buzzer and/or LED alert support only after compatibility confirmation.
- Output test mode with explicit user confirmation.
- Logging of output command attempts and failures.

Acceptance:

- All outputs are off on boot and when config is missing.
- Buzzer voltage/current and input polarity are documented before enabling.
- LED resistor values are identified and documented.
- Vibration motor remains disabled.
- Manual tests confirm physical behavior; software alone is not treated as proof.

### Phase 5 — Future accounts and shared database

Deliverables, later:

- Authentication.
- User/admin roles.
- Shared database/API adapter.
- Sync rules and conflict handling.
- Multi-device profile management.

Acceptance:

- Local-first behavior still works when offline.
- Existing local data can be imported or migrated.
- Admin and user roles are enforced server-side, not only in UI.

---

## 14. Unresolved hardware questions

These must be answered before hardware wiring, flashing, or output tests:

1. What is the exact ESP32-CAM board model and seller/listing?
2. What is the exact GC2145-to-ESP32 pin mapping on this board?
3. Does this board have PSRAM, and how much?
4. Which capture resolutions and pixel formats does the GC2145 driver actually support here?
5. What maximum FPS is stable at each useful resolution?
6. Is software JPEG encoding feasible on this board, or is raw/binary transport better?
7. Can the ESP32-CAM-MB supply enough current for camera operation plus future outputs?
8. What is the active buzzer’s rated voltage, current draw, and logic polarity?
9. What are the values of the unidentified resistors?
10. What forward voltage and safe current should be used for each red LED?
11. What voltage and current does the small DC vibration motor require?
12. Is any suitable transistor/MOSFET driver available for the motor? Current inventory says no; therefore motor stays disabled.
13. Can the MacBook and phone reach the ESP32 on the intended Wi-Fi network, or does the router enable client isolation?
14. Can the phone trust a local HTTPS certificate, or is a tunnel needed for development?
15. How will outputs be powered safely without relying on the ESP32-CAM-MB as a permanent supply?
16. What enclosure, mounting, and fail-safe power behavior will be used for real-world testing?

---

## 15. Definition of done for the overall project

The project is functionally complete when:

- Admin and user web apps are responsive on MacBook and phones.
- Built-in webcam, phone camera, and ESP32-CAM can be selected.
- Video processing and detection run on the MacBook or phone, not the ESP32.
- Prolonged eye closure and possible yawning are detected with configurable thresholds.
- Normal blinks are distinguished from sustained closure.
- Missing face, poor lighting, unavailable camera, frozen video, low FPS, and hidden tab are monitoring problems and never imply “awake.”
- Configurable thresholds and a complete calibration flow exist.
- Browser visual and sound alerts work.
- Hardware alerts remain disabled until electrical compatibility is confirmed.
- Local-first storage works without a paid database.
- No video or face images are stored by default.
- Settings and event history can be exported and deleted.
- Storage and service interfaces leave a clear path to accounts and a shared database later.
- Unresolved hardware questions are either resolved or the affected feature remains disabled.
