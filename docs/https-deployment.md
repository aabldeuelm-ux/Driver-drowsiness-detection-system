# HTTPS deployment preparation

The portable demo is a static browser app. Camera access, browser sound, and
Web Serial all require a secure context; deploy the built `dist/` directory over
HTTPS. Nothing in the deployed bundle needs a local server or Wi-Fi credentials.

## Build

From `apps/admin`:

```bash
npm run check
npm run build
```

Output: `apps/admin/dist/`

The Vite config uses relative asset URLs, so the bundle can be served from a
domain root or a subpath. For the exact Vercel import settings, see
[`vercel-deployment.md`](vercel-deployment.md). No publish step is performed by
the repository itself; publishing happens in the hosting dashboard.

## Static host requirements

- Serve over HTTPS with a valid certificate.
- Serve every file under `dist/` with correct `text/javascript`, `text/css`, and
  `image/*`/font MIME types as applicable.
- No server-side rendering, API, database, or SPA rewrite is required; the app
  keeps its active screen in client state.
- The MediaPipe WASM and model are loaded from the pinned public URLs documented
  in `apps/admin/README.md`. The first load needs internet access.
- Do not inject Wi-Fi credentials, firmware files, or local server addresses into
  the deployed bundle.

## Browser requirements

- Use desktop Chrome or Edge for Web Serial. WebDriver-style automated browsers
  and Safari/Firefox do not provide the `navigator.serial` permission flow used
  here.
- The origin must be HTTPS. `http://localhost` is acceptable only for local
  development on the same machine, not for a second laptop.
- The user grants camera and serial permission explicitly in the browser prompt.
- A plain-HTTP ESP32 cannot be fetched from an HTTPS page because of mixed
  content rules. Use the USB serial transport on the deployed app; the Wi-Fi
  controller path remains available for local HTTP development as a fallback.

## Portable laptop flow

1. One time only, upload build `usb-serial-alert-controller-2026-11-22-v3` from `firmware/usb_serial_alert_controller/usb_serial_alert_controller.ino` to the ESP32. This is the only firmware that changes for escalation; the Wi-Fi sketch is untouched. A browser refresh alone cannot fix a v2 device: its HELLO ACK truncates `features=escalation` to `features=escal`.
2. Keep the webcam and ESP32 connected by USB to any laptop.
3. Open the deployed HTTPS URL in desktop Chrome, grant camera permission, select the external webcam, start tracking, and calibrate on that laptop/session.
4. In the alert-device panel choose **USB serial alert controller (portable)**, click **Connect USB alert device**, choose the ESP32 serial port, and wait for handshake verification. The panel reports the verified build and says that escalation is disabled in this release; the firmware may still advertise the capability.
5. Click **Test hardware alert**, then enable **ESP32 hardware alerts (this session only)** and start monitoring.
6. Reopen after each closure to rearm. Each episode sends only the original one-shot LED and 1-second 2 kHz buzzer command. The five-second repeating pattern is intentionally off and sends no `ESCALATE` command.
7. Disconnecting the USB device invalidates in-flight commands. Nothing is replayed after reconnecting.

## Deployment verification checklist

- `npm run check` passes before publishing.
- `dist/index.html` and hashed assets are served over HTTPS.
- Camera permission and external webcam selection work on a second laptop.
- Calibration is repeatable per browser session and after camera changes.
- Web Serial is advertised as supported in Chrome/Edge and the unsupported message appears elsewhere.
- Handshake rejects an unexpected device identity.
- Manual test and closure-triggered alerts both use the selected transport.
- Five-second escalation is disabled in this release: no `ESCALATE|START`, `RENEW`, or `STOP` command is sent, even if the firmware advertises the feature.
- One-shot LED/buzzer alerts still require a live webcam, the session toggle, and the selected verified transport.
- Disconnecting or unplugging USB never replays an alert after reconnecting.
- Browser sound still plays independently of hardware command acknowledgments.
- History, settings, and exports remain local to each browser.
