import {
  Activity,
  CameraOff,
  CirclePause,
  CircleSlash,
  Crosshair,
  Gauge,
  Minus,
  Play,
  Square,
  Timer,
  Volume2,
  WifiOff,
} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';
import {CameraSourceSelector} from './CameraSourceSelector';
import {StatusBadge} from './StatusBadge';

interface LiveMonitoringScreenProps {
  selectedCamera: CameraSource;
  onSelectCamera: (source: CameraSource) => void;
}

export function LiveMonitoringScreen({
  selectedCamera,
  onSelectCamera,
}: LiveMonitoringScreenProps) {
  const isThisDevice = selectedCamera === 'this-device';

  const dropdownPlaceholder =
    selectedCamera === 'this-device'
      ? 'No browser cameras enumerated yet'
      : selectedCamera === 'esp32-cam'
        ? 'ESP32-CAM stream not connected'
        : 'Select a camera source first';

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
      {/* Main preview & controls */}
      <section
        aria-labelledby="live-monitoring-preview-heading"
        className="flex flex-col rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="live-monitoring-preview-heading"
              className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
            >
              Live Camera Feed
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
              Interface prototype for camera preview, calibration, and session controls.
            </p>
          </div>

          <StatusBadge
            icon={<CirclePause className="h-3.5 w-3.5" />}
            label="Monitoring not started"
            tone="neutral"
          />
        </div>

        {/* Large camera preview placeholder */}
        <div className="relative mt-4 flex min-h-[220px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-700/80 bg-[#090F1D] px-5 py-8 text-center sm:mt-5 sm:aspect-video sm:px-6 sm:py-10">
          <span
            className="pointer-events-none absolute top-3 left-3 h-4 w-4 border-t border-l border-slate-700/80"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute top-3 right-3 h-4 w-4 border-t border-r border-slate-700/80"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-slate-700/80"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute right-3 bottom-3 h-4 w-4 border-r border-b border-slate-700/80"
            aria-hidden="true"
          />

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/60 text-slate-400">
            <CameraOff className="h-6 w-6" aria-hidden="true" />
          </div>

          <p className="mt-4 text-base font-medium text-slate-100 sm:text-lg">
            {selectedCamera === null
              ? 'Choose a camera to begin.'
              : 'Camera preview unavailable in prototype.'}
          </p>

          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
            {selectedCamera === null &&
              'Select This device or ESP32-CAM below. Live video capture and eye detection are not active in this interface prototype.'}
            {selectedCamera === 'this-device' &&
              'This device is selected. Browser camera permissions and eye-closure detection are not enabled in this interface prototype.'}
            {selectedCamera === 'esp32-cam' &&
              'ESP32-CAM is selected. Network stream playback and eye-closure detection are not enabled in this interface prototype.'}
          </p>
        </div>

        {/* Source selector + Available camera dropdown */}
        <div className="mt-5 space-y-5">
          <CameraSourceSelector
            selectedCamera={selectedCamera}
            onSelectCamera={onSelectCamera}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="available-camera-select"
              className="block text-xs font-medium text-slate-300 sm:text-sm"
            >
              Available camera
            </label>
            <select
              id="available-camera-select"
              disabled
              defaultValue=""
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2.5 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
            >
              <option value="">{dropdownPlaceholder}</option>
            </select>
            <p className="text-xs text-slate-400">
              Camera device listing is disabled until browser media access or ESP32 stream discovery is connected.
            </p>
          </div>

          {/* Session & calibration action controls */}
          <div className="space-y-3 border-t border-slate-800/80 pt-4">
            <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-500/30 px-4 py-2.5 text-sm font-semibold text-teal-200/70 disabled:cursor-not-allowed"
              >
                <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start</span>
              </button>

              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Stop</span>
              </button>

              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Calibrate</span>
              </button>

              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Test sound</span>
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Start, Stop, Calibrate, and Test sound controls are disabled because camera capture, eye-closure detection, and alert audio playback are not implemented in this interface prototype.
            </p>
          </div>
        </div>
      </section>

      {/* Live status & measurements rail */}
      <div className="flex flex-col gap-5 lg:col-span-4 lg:gap-6">
        <section
          aria-labelledby="monitoring-state-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
        >
          <h2
            id="monitoring-state-heading"
            className="text-base font-semibold tracking-tight text-slate-100"
          >
            Session &amp; Detection State
          </h2>

          <ul className="mt-4 divide-y divide-slate-800/80">
            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-1">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <CirclePause className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Session status</span>
              </span>
              <StatusBadge
                icon={<CirclePause className="h-3.5 w-3.5" />}
                label="Monitoring not started"
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Detection status</span>
              </span>
              <StatusBadge
                icon={<CircleSlash className="h-3.5 w-3.5" />}
                label="Detection not enabled"
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 last:pb-1">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <WifiOff className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>ESP32</span>
              </span>
              <StatusBadge
                icon={
                  isThisDevice ? (
                    <Minus className="h-3.5 w-3.5" />
                  ) : (
                    <CircleSlash className="h-3.5 w-3.5" />
                  )
                }
                label={isThisDevice ? 'Not required' : 'Not connected'}
              />
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="live-measurements-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
        >
          <h2
            id="live-measurements-heading"
            className="text-base font-semibold tracking-tight text-slate-100"
          >
            Measurements
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Values remain empty until an active camera stream and detection loop run.
          </p>

          <dl className="mt-4 divide-y divide-slate-800/80">
            <div className="flex items-center justify-between gap-3 py-3 first:pt-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Timer className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Eye-closure duration</span>
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-slate-100">
                —
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3 last:pb-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Gauge className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Frame rate</span>
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-slate-100">
                —
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
