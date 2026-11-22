import {
  CircleSlash,
  Crosshair,
  Download,
  Eye,
  HardDrive,
  Info,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import {StatusBadge} from './StatusBadge';

export function SettingsCalibrationScreen() {
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Prototype notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 sm:px-5">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <p className="leading-relaxed">
          Settings persistence and calibration are not implemented yet. Form fields and local data controls below show the planned layout for this prototype without saving changes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
        {/* Eye-Closure & Yawn Detection Settings */}
        <section
          aria-labelledby="detection-thresholds-heading"
          className="space-y-6 rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6 lg:col-span-7"
        >
          <div>
            <div className="flex items-center gap-2.5">
              <Eye className="h-4 w-4 text-teal-400" aria-hidden="true" />
              <h2
                id="detection-thresholds-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                Eye-Closure Thresholds
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400 sm:text-sm">
              Parameters controlling when prolonged eye closure triggers a warning or critical alert.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="ear-threshold-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Eye-closure threshold (EAR)
                </label>
                <input
                  id="ear-threshold-input"
                  type="text"
                  disabled
                  value=""
                  placeholder="Not calibrated"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <p className="text-xs text-slate-400">
                  Determined after open-eye baseline calibration.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="warning-duration-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Warning closure duration (ms)
                </label>
                <input
                  id="warning-duration-input"
                  type="text"
                  disabled
                  value=""
                  placeholder="Not configured"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <p className="text-xs text-slate-400">
                  Duration before raising an amber warning.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="critical-duration-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Critical alert duration (ms)
                </label>
                <input
                  id="critical-duration-input"
                  type="text"
                  disabled
                  value=""
                  placeholder="Not configured"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <p className="text-xs text-slate-400">
                  Duration before triggering a critical red drowsiness alert.
                </p>
              </div>
            </div>
          </div>

          {/* Possible-yawn settings */}
          <div className="border-t border-slate-800/80 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal
                  className="h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-semibold text-slate-100 sm:text-base">
                  Possible-Yawn Detection
                </h3>
              </div>

              <StatusBadge
                icon={<CircleSlash className="h-3.5 w-3.5" />}
                label="Not enabled"
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="yawn-ratio-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Mouth-opening threshold
                </label>
                <input
                  id="yawn-ratio-input"
                  type="text"
                  disabled
                  value=""
                  placeholder="Not configured"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="yawn-duration-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Minimum yawn duration (ms)
                </label>
                <input
                  id="yawn-duration-input"
                  type="text"
                  disabled
                  value=""
                  placeholder="Not configured"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
              </div>
            </div>
          </div>

          {/* Sound settings */}
          <div className="border-t border-slate-800/80 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Volume2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-100 sm:text-base">
                  Sound Settings
                </h3>
              </div>

              <StatusBadge
                icon={<CircleSlash className="h-3.5 w-3.5" />}
                label="Not configured"
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="sound-tone-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Alert tone
                </label>
                <select
                  id="sound-tone-select"
                  disabled
                  defaultValue=""
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3 py-2 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <option value="">Audio playback not enabled yet</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="sound-volume-range"
                  className="block text-xs font-medium text-slate-300"
                >
                  Browser alert volume
                </label>
                <div className="flex min-h-[44px] items-center rounded-lg border border-slate-800 bg-[#0B1221] px-3.5">
                  <input
                    id="sound-volume-range"
                    type="range"
                    disabled
                    min={0}
                    max={100}
                    defaultValue={0}
                    className="w-full accent-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Calibration & Local Browser Data */}
        <div className="flex flex-col gap-5 lg:col-span-5 lg:gap-6">
          <section
            aria-labelledby="calibration-heading"
            className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="calibration-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                Eye Calibration
              </h2>

              <StatusBadge
                icon={<CircleSlash className="h-3.5 w-3.5" />}
                label="Not calibrated"
              />
            </div>

            <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-300">
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  01.
                </span>
                <span>
                  Position the camera near eye level with clear, even lighting across your face.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  02.
                </span>
                <span>
                  Look forward naturally for a few seconds so open-eye baseline geometry can be measured.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  03.
                </span>
                <span>
                  Perform a brief deliberate eye closure to verify threshold responsiveness before monitoring.
                </span>
              </li>
            </ol>

            <div className="mt-5 border-t border-slate-800/80 pt-4">
              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-teal-500/30 px-4 py-2.5 text-sm font-semibold text-teal-200/70 disabled:cursor-not-allowed"
              >
                <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start calibration</span>
              </button>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Calibration is not implemented yet and requires an active camera feed.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="local-data-heading"
            className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6"
          >
            <div className="flex items-center gap-2.5">
              <HardDrive
                className="h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <h2
                id="local-data-heading"
                className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
              >
                Local Browser Data
              </h2>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
              Settings and alert history are stored only in this browser and do not automatically sync across devices.
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Export browser data</span>
              </button>

              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Import browser data</span>
              </button>

              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-2 text-sm font-medium text-red-300/70 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Delete local data</span>
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Data export, import, and deletion controls are disabled until browser storage persistence is implemented.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
