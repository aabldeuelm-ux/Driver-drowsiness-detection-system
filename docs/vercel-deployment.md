# Vercel import instructions

This repository contains the working webcam monitoring app in `apps/admin`.
The root directory for Vercel must be `apps/admin`; the repository root is only
source storage for firmware, design history, and documentation.

## Import

1. In Vercel, choose **Add New… → Project**.
2. Select the GitHub repository:
   `aabldeuelm-ux/Driver-drowsiness-detection-system`.
   If it is not listed, install/authorize the Vercel GitHub app for that account
   or organization first.
3. Under **Configure Project**, click **Edit** next to **Root Directory** and
   select `apps/admin`.
4. Set the build settings explicitly:
   - **Framework Preset:** `Vite` (auto-detected; select it if blank)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install` (Vercel default)
5. Add **no** environment variables. The app needs no API key, Wi-Fi secret, or
   server. The deployed bundle contains no `.env` file or `secrets.h`.
6. Click **Deploy**. The site is not published until this step completes
   successfully and Vercel reports the deployment as ready.

These settings are also recorded in `apps/admin/vercel.json`.

## Routing check

The app does not use a client-side router or browser history paths. The active
screen is held in React state, so Vercel only needs to serve `index.html` at `/`.
No SPA rewrite rule is required. The production `index.html` references hashed
assets with relative `./assets/...` URLs because `vite.config.ts` uses
`base: './'`; this works from a domain root or a Vercel preview subpath.

## Face-tracking asset check

`src/vision/mediapipeAssets.ts` pins `@mediapipe/tasks-vision@1.2.3` and loads:

- WASM files from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm`
- The Face Landmarker model from
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`

Both are HTTPS URLs, so they do not create mixed-content errors on a Vercel
HTTPS deployment. The fileset is fetched only when **Start tracking** is
clicked. The first load requires internet access from the client.

## Browser requirements after deployment

- Camera, browser sound, and Web Serial require the Vercel HTTPS URL.
- Web Serial is available in desktop Chrome/Edge only. Other browsers show the
  unsupported message; Wi-Fi remains a local-HTTP fallback.
- USB mode requires one verified handshake per page session, explicit serial
  permission, and no Wi-Fi setup on the second laptop.
- Five-second escalation is intentionally disabled in this release. The
  original one-shot LED/buzzer alert and browser sound remain active.
