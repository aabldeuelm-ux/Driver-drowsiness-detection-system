# Driver Drowsiness Detection System

Webcam-based eye-closure monitoring demo with browser audio and optional ESP32
LED/buzzer alerts over USB serial or a local Wi-Fi fallback.

## Deployed app

The browser app lives in [`apps/admin`](apps/admin). Vercel should import this
repository with **Root Directory** set to `apps/admin`, **Build Command**
`npm run build`, and **Output Directory** `dist`. Exact steps are in
[`docs/vercel-deployment.md`](docs/vercel-deployment.md).

## Local development

```bash
cd apps/admin
npm install
npm run check
npm run dev
```

`npm run check` runs the TypeScript typecheck, Vitest suite, and production
Vite build.

## Hardware

- USB is the portable path: one firmware upload, then browser serial permission
  on any laptop over HTTPS.
- Wi-Fi is a local-HTTP fallback.
- Five-second buzzer escalation is intentionally disabled in this release; only
  the original one-shot LED/buzzer alert is active.
- No Wi-Fi credentials, `.env` values, `secrets.h`, dependencies, build output,
  or backup archives are committed. Copy `*.example.h` or `.env.example` when a
  local template is needed.

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the verified stopping point and
[`docs/https-deployment.md`](docs/https-deployment.md) for browser requirements.
