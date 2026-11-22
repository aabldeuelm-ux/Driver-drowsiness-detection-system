# Driver Drowsiness Detection — Admin Interface Prototype

This is the local-first admin interface integrated from the exported AI Studio design into React, TypeScript, Vite, and Tailwind. The original export is preserved separately under `design/ai-studio/driver-drowsiness-detection-system/`.

## What works now

- All five admin screens and the setup dialog.
- Desktop sidebar and mobile drawer navigation.
- Device camera access from **Live Monitoring** after an explicit **Start camera** click.
- Video-only permission requests; microphone access is never requested.
- Muted, inline video preview with a mirror toggle and video-input enumeration after permission is granted.
- Camera switching, with previous video tracks stopped before the next camera opens.
- **Stop camera**, page exit, and leaving Live Monitoring release all camera tracks.
- Permission denial, no camera, busy camera, disconnected camera, unsupported browser, and insecure-context messages with a retry action where applicable.
- Actual camera connection state and resolution shown in the dashboard, setup dialog, and Live Monitoring.
- `This device` shows ESP32 as `Not required` in every status display.
- Explicit **Start tracking** / **Stop tracking** controls for local MediaPipe face tracking.
- Model **loading**, **ready**, **running**, page-hidden **paused**, and retryable **error** states.
- One-face EAR measurement, `No face detected`, `Monitoring problem: multiple faces`, and separate stale reasons for `camera frames stopped` versus `inference stalled`.
- Camera-frame arrival and inference completion are tracked independently with one monotonic clock. Actual completed-inference FPS is shown over a rolling window as `Measuring…` during warm-up.
- Optional eye-landmark overlay aligned with the mirrored, `object-cover` preview.
- Guided, in-memory eye calibration with a preparation interval, progress, cancellation, failure explanations, retry, transition-frame rejection, and separate left/right thresholds.
- A compact calibration diagnostics panel showing per-eye open/closed sample summaries, close/reopen thresholds, current EAR, and classification.
- Experimental bilateral eye-closure measurement with calibrated hysteresis, timestamp-based duration, and explicit **Start monitoring** / **Stop monitoring** controls.
- A configurable prolonged-closure duration in milliseconds, validated and stored in IndexedDB.
- All tracking, face, calibration, and monitoring badges derive from one controller-owned state snapshot; face-tracking badge colors are independent of eye-closure severity.
- Browser sound alerts unlocked by an explicit user click, with Test sound, mute, and volume controls.
- One short locally generated two-tone alert per new prolonged-closure episode. Ordinary blinks and tracking problems stay visual-only, and audio stops on monitoring stop, tracking loss, camera stop, hidden tabs, or page exit.
- A Dexie/IndexedDB event log with one metadata-only record per episode and an end reason of `eyes reopened`, `monitoring stopped`, or `tracking interrupted`.
- Alert History filters, JSON/CSV export of visible rows, and a confirmed clear-history action.
- Dashboard recent alerts and session/historical counts backed by stored events, with honest storage-error messages that never stop visual monitoring.

EAR is an experimental geometric measurement, not a probability, alertness score, or diagnosis. This phase never classifies the driver as awake, safe, or drowsy.

## Calibration method and limitations

Calibration runs only while tracking is active, exactly one face is visible, and tracking results are fresh. The user is instructed to sit naturally at eye level with both eyes open for several seconds. The app then shows a preparation instruction and waits before collecting closed-eye samples, so reaction and transition frames do not enter the baseline. The final prompt asks the user to close both eyes completely and hold still.

For each eye independently, the app collects valid open-eye and deliberate-closure EAR samples. Closed-stage frames must be clearly below the low end of that eye's measured open samples; otherwise they are counted as rejected transition frames. The close threshold is the midpoint between that eye's open and closed sample means. The reopen threshold adds hysteresis but is capped at the 10th percentile of the measured open samples, so ordinary open-eye variation can end a closure state. Calibration fails if measurements are invalid, results are stale or interrupted, the camera resolution changes mid-flow, too few stable samples are collected, or the open/closed sample ranges overlap or are too close. Progress, rejection counts, a plain-language failure reason, and a retry action are shown in Live Monitoring. No observed EAR value is hardcoded as a threshold.

Thresholds depend on camera position, resolution, lighting, and individual anatomy. They are valid only for the camera and resolution used during calibration and are discarded when either changes. Calibration is held in memory for the page session only; there is no persistence, export, or cross-device sync. This is an experimental measurement, not a clinical or safety-grade assessment.

## Eye-closure measurement

Monitoring requires a successful calibration and an explicit **Start monitoring** click. Each eye is compared with its own calibrated close threshold. Bilateral closure requires both eyes to be below their thresholds; a small hysteresis band (capped to measured open variation) and two-sample confirmation reduce flicker. A value above the close threshold but not yet above the reopen threshold is labelled as inside the hysteresis band in diagnostics. Elapsed duration uses monotonic timestamps, never frame counts.

The diagnostics panel reports the last successfully inferred EAR result, which is the same result used to draw the landmark overlay and update the status badges. The preview video continues to advance between inferences, so the displayed EAR and overlay can be one or more presented frames behind the picture; the panel also shows measurement age. This is a timing limitation of frame-by-frame inference, not a second measurement source.

The visual states are intentionally limited to:

- `Not calibrated`
- `Ready`
- `Monitoring: eyes open`
- `Eyes closed`
- `Prolonged eye closure`
- `Monitoring unavailable`

A missing face, multiple faces, stale frames, a hidden tab, or an excessive inference gap resets the elapsed timer and shows **Monitoring unavailable** with the specific reason. The reason remains visible until monitoring is stopped and restarted. Stopping monitoring clears the timer; stopping tracking also stops monitoring.

The **Prolonged eye-closure duration** setting is experimental. It is measured in milliseconds of continuous bilateral closure, defaults to `800 ms`, and accepts whole values from `200` to `5000` ms. It is stored in IndexedDB with the sound preferences and is locked while monitoring is active.

## Sound alerts and local event history

Audio is generated locally with Web Audio. Creating or resuming an `AudioContext` happens only from **Enable sound**, **Test sound**, or a Start monitoring click, which is required for Safari/iOS autoplay rules. A persisted sound preference still needs a new click after each reload. If audio is blocked or unsupported, the UI says so and visual monitoring continues. Mute suppresses playback immediately; volume is applied to the short two-tone pattern.

One alert and one event are emitted when a new prolonged-closure episode begins. Repeated frames in the same episode do not add sounds or records. The episode ends with `eyes reopened`, `monitoring stopped`, or `tracking interrupted`, and the same record is updated with its end time and final observed duration. Closure time never bridges a tracking gap, and a new alert is only armed after a `Monitoring: eyes open` state. Stopping monitoring, losing tracking, stopping the camera, hiding the tab, or leaving the page stops active audio.

Events are stored with Dexie in IndexedDB in this browser. Each record contains only an ID, session ID, timestamp, camera source, configured threshold, observed closure duration, end metadata, and a schema version. No frames, images, video, recordings, face landmarks, calibration samples, or analytics are stored or uploaded. Records do not sync across devices and may be removed by clearing browser data. Alert History exports the currently visible rows as JSON or CSV; **Delete local data** in Settings clears events and resets saved settings after confirmation. Calibration remains session-only and must be repeated after a reload.

Storage failures are reported in Live Monitoring, Alert History, and Settings. Monitoring and visual state continue to work when IndexedDB is unavailable; affected records may not survive a reload.

## Still intentionally unavailable

- Drowsiness classification and severity escalation; those UI controls remain labelled **Not implemented**.
- Hardware outputs, ESP32 streaming, firmware, and wiring.
- Possible-yawn detection.
- Settings import and cloud sync.
- Uploading, recording, or storing camera frames.

Unavailable controls remain disabled or labelled as placeholders. No state labels the person `Safe`, `Awake`, or `Drowsy`.

## Local processing, model assets, and privacy

Camera frames are decoded and processed in the browser by MediaPipe Face Landmarker. This app does not upload, record, or persist frames, screenshots, or face images. Camera streams, landmarks, and calibration measurements are held in memory only for the active page session. Event history and the duration/sound preferences are stored locally in IndexedDB as described above.

The vision layer is isolated under `src/vision/`: pure EAR geometry, the in-memory calibration and closure state machines, a framework-independent tracking controller, the React binding, and MediaPipe asset configuration. The overlay in `src/components/EyeLandmarkOverlay.tsx` is presentation-only. Alert storage and audio live behind interfaces under `src/alerts/`: a Dexie repository, an episode recorder, and a Web Audio manager, with in-memory/fake implementations used in tests.

MediaPipe assets are fetched from official public endpoints only after **Start tracking** is clicked:

| Asset | Source |
|---|---|
| WASM fileset | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm` |
| Face Landmarker model | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` |

The npm package is pinned to `@mediapipe/tasks-vision` `1.2.3`. An internet connection is required for the first model/WASM download, and remote asset availability is required unless the files are later vendored into the app. Browser caching may avoid later downloads, but offline use is not guaranteed by this prototype. A failed download is shown as a retryable error; camera frames are not involved in that request.

MediaPipe's privacy notice states that input data such as video is processed on device and is not sent to Google servers. It also states that MediaPipe Tasks APIs send performance and utilization metrics to Google. This app adds no analytics or API-key integrations. See the official [Face Landmarker Web JS guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js), [MediaPipe Web setup guide](https://developers.google.com/edge/mediapipe/solutions/setup_web), and [`@mediapipe/tasks-vision` package README](https://www.npmjs.com/package/@mediapipe/tasks-vision) for upstream details.

## Local commands

From this directory:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 for local development only.

For the portable two-laptop demo, build the static bundle and serve it over
HTTPS from desktop Chrome or Edge. See [`../../docs/https-deployment.md`](../../docs/https-deployment.md)
for the deployment and Web Serial permission flow, and
[`../../docs/vercel-deployment.md`](../../docs/vercel-deployment.md) for exact
Vercel root/build/output settings. The deployed bundle has no local-server or
Wi-Fi-secret dependency.

Automated checks:

```bash
npm run typecheck
npm run test
npm run build
```

Or all together:

```bash
npm run check
```

### Automated verification status

`npm run check` was run locally and passed: TypeScript typecheck, 13 test files / 114 tests, and the production Vite build. The suite includes serial protocol framing, handshake/feature verification with the exact firmware v3 HELLO ACK and strict rejection of the truncated v2 token, NACK handling, one-shot delivery, no-replay cancellation, the disabled release gate, 5-second escalation gating, lease renewal, every stop condition, missing-frame rejection, and reconnect latching tests.

The automated suite covers camera lifecycle, pixel-based EAR geometry (including a check that left/right indices stay inside MediaPipe's own subject-based eye contours), tracking loss, multiple faces, both stale reasons, completed-inference FPS warm-up/windowing, retryable model failure, recoverable inference errors, page-hidden pause/resume, frame deduplication with zero `mediaTime`, inference cleanup, calibration rejection and retry, transition-frame rejection, overlapping sample-set rejection, threshold and capped reopen-threshold derivation, normal blinks, sustained bilateral closure, one-eye closure, calibrated hysteresis, partly-open reopening, open-eye variation, stale-frame/timestamp-gap/hidden-tab timer resets, camera/resolution invalidation, face-badge tone independence, live diagnostic classification, Dexie persistence/reload handling with fake IndexedDB, settings sanitization, JSON/CSV export formatting, audio unlock/blocked/unsupported states, mute/volume, one-shot playback, all episode end reasons, rearming, storage-failure reporting, and page-level interruption cleanup. It does not replace physical verification with a real camera or real browser audio.

### Manual verification still required

Physical checks still need to be performed on target devices and browsers, especially Safari: permission prompts, real webcam and camera switching, camera busy/disconnect behaviour, OS camera indicators, real face tracking and EAR output, model-download failure/retry, Safari behaviour, page-hidden resume, overlay alignment with real video, guided open/closed calibration under real lighting, sample summaries and close/reopen thresholds in the diagnostics panel, threshold stability across camera positions, normal blink versus sustained closure, partly open eyes inside the hysteresis band, one-eye closure, interruption/restart behaviour, Safari audio unlock after reload, Test sound, audible one-shot alert on a real prolonged closure, absence of any repeating tone after 5 seconds in this release, mute and volume changes, audio cleanup on stop/hidden/camera loss, IndexedDB behaviour with real browser-data clearing, JSON/CSV export downloads, clear-history confirmation, and storage-failure messaging.

No API key or external AI service is required. No deployment or publishing command is included.
