import {useEffect, useState} from 'react';
import {
  CircleSlash,
  Crosshair,
  Download,
  Eye,
  HardDrive,
  Info,
  Play,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  audioStatusLabel,
  audioStatusTone,
} from '../alerts/audioManager';
import {useAlerts} from '../alerts/AlertsContext';
import {
  DEFAULT_PROLONGED_CLOSURE_MS,
  MAX_PROLONGED_CLOSURE_MS,
  MIN_PROLONGED_CLOSURE_MS,
  validateProlongedClosureMs,
} from '../vision/eyeClosureMonitor';
import {useTracking} from '../vision/TrackingContext';
import {StatusBadge} from './StatusBadge';

export function SettingsCalibrationScreen() {
  const tracking = useTracking();
  const alerts = useAlerts();
  const [durationInput, setDurationInput] = useState(
    String(alerts.settings.prolongedClosureMs),
  );
  const [durationError, setDurationError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const calibration = tracking.state.calibration;
  const result = calibration.result;
  const monitoringActive = tracking.state.monitoring.active;

  useEffect(() => {
    setDurationInput(String(alerts.settings.prolongedClosureMs));
    setDurationError(null);
  }, [alerts.settings.prolongedClosureMs, alerts.settingsHydrated]);

  const handleDurationChange = (value: string) => {
    setDurationInput(value);
    const parsed = value.trim() === '' ? Number.NaN : Number(value);
    const validation = validateProlongedClosureMs(parsed);
    if (!validation.ok) {
      setDurationError(validation.message);
      return;
    }
    setDurationError(null);
    alerts.setProlongedClosureMs(validation.value);
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    await alerts.clearAllData();
    setDeleting(false);
    setConfirmingDelete(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 sm:px-5">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <p className="leading-relaxed">
          Prolonged-closure duration and sound preferences are saved in IndexedDB in
          this browser. Calibration stays in memory only, so recalibrate after every
          reload. Guided calibration and Start monitoring run in Live Monitoring
          because they need active camera frames.
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
              Per-eye thresholds are derived from guided calibration. The
              prolonged duration is an experimental starting value.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="left-ear-threshold-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Left eye threshold (EAR)
                </label>
                <input
                  id="left-ear-threshold-input"
                  type="text"
                  disabled
                  value={result ? result.left.threshold.toFixed(3) : ''}
                  placeholder="Not calibrated"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <p className="text-xs text-slate-400">
                  Midpoint of measured open and closed means. Reopens above{' '}
                  {result ? result.left.reopenThreshold.toFixed(3) : '—'} EAR.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="right-ear-threshold-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Right eye threshold (EAR)
                </label>
                <input
                  id="right-ear-threshold-input"
                  type="text"
                  disabled
                  value={result ? result.right.threshold.toFixed(3) : ''}
                  placeholder="Not calibrated"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-400 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-75"
                />
                <p className="text-xs text-slate-400">
                  Calculated separately from the left eye. Reopens above{' '}
                  {result ? result.right.reopenThreshold.toFixed(3) : '—'} EAR.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="prolonged-closure-duration-input"
                  className="block text-xs font-medium text-slate-300"
                >
                  Prolonged eye-closure duration (ms, experimental)
                </label>
                <input
                  id="prolonged-closure-duration-input"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PROLONGED_CLOSURE_MS}
                  max={MAX_PROLONGED_CLOSURE_MS}
                  step={1}
                  value={durationInput}
                  onChange={(event) => handleDurationChange(event.target.value)}
                  disabled={!alerts.settingsHydrated || monitoringActive}
                  aria-invalid={durationError !== null}
                  aria-describedby="prolonged-closure-duration-help"
                  className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2 font-mono text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                />
                <p
                  id="prolonged-closure-duration-help"
                  className="text-xs leading-relaxed text-slate-400"
                >
                  Milliseconds of continuous bilateral closure before a warning
                  event and sound alert. Default {DEFAULT_PROLONGED_CLOSURE_MS} ms;
                  allowed {MIN_PROLONGED_CLOSURE_MS}–{MAX_PROLONGED_CLOSURE_MS} ms.
                  Saved in this browser. Changes are locked while monitoring is active.
                </p>
                {durationError && (
                  <p className="text-xs text-amber-300" role="alert">
                    {durationError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-300">
                    Critical alert duration
                  </span>
                  <StatusBadge
                    icon={<CircleSlash className="h-3.5 w-3.5" />}
                    label="Not implemented"
                  />
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  Browser sound alerts are configured below; severity escalation and
                  drowsiness classification are still unimplemented.
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
                icon={<Volume2 className="h-3.5 w-3.5" />}
                label={audioStatusLabel(alerts.audio)}
                tone={audioStatusTone(alerts.audio)}
              />
            </div>

            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              A short two-tone alert plays only when a new prolonged-closure episode
              starts. Blinks and tracking problems stay visual-only. Safari requires a
              click after every reload before audio can play.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void alerts.enableSound()}
                  disabled={alerts.audio.status === 'ready' || alerts.audio.status === 'unsupported'}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-500/30 disabled:text-teal-200/70"
                >
                  <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {alerts.audio.status === 'ready'
                    ? 'Sound enabled'
                    : 'Enable sound'}
                </button>
                <button
                  type="button"
                  onClick={() => void alerts.testSound()}
                  disabled={
                    !alerts.settingsHydrated ||
                    alerts.audio.muted ||
                    alerts.audio.status === 'unsupported'
                  }
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Test sound
                </button>
              </div>

              <div className="space-y-3">
                <label className="flex min-h-[28px] items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={alerts.audio.muted}
                    onChange={(event) => alerts.setMuted(event.target.checked)}
                    className="h-4 w-4 accent-teal-500"
                  />
                  <VolumeX className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  Mute alert sound
                </label>

                <div className="space-y-1.5">
                  <label
                    htmlFor="sound-volume-range"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Browser alert volume ({alerts.audio.volume}%)
                  </label>
                  <div className="flex min-h-[44px] items-center rounded-lg border border-slate-800 bg-[#0B1221] px-3.5">
                    <input
                      id="sound-volume-range"
                      type="range"
                      min={0}
                      max={100}
                      value={alerts.audio.volume}
                      disabled={!alerts.settingsHydrated}
                      onChange={(event) => alerts.setVolume(Number(event.target.value))}
                      className="w-full accent-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </div>

            {alerts.audio.message && (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-200" role="status">
                {alerts.audio.message}
              </p>
            )}
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
                icon={<Crosshair className="h-3.5 w-3.5" />}
                label={tracking.state.calibrationLabel}
                tone={tracking.state.calibrationTone}
              />
            </div>

            <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-300">
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  01.
                </span>
                <span>
                  Open Live Monitoring, start the camera, then Start tracking.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  02.
                </span>
                <span>
                  Sit naturally with eyes open for a few seconds, then briefly
                  close both eyes when prompted.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-xs font-semibold text-teal-400">
                  03.
                </span>
                <span>
                  Start monitoring to see experimental bilateral closure states.
                </span>
              </li>
            </ol>

            {calibration.failure && (
              <p className="mt-3 text-xs leading-relaxed text-amber-300">
                {calibration.failure.message}
              </p>
            )}

            {result && (
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-slate-400">
                Left {result.left.threshold.toFixed(3)} · Right{' '}
                {result.right.threshold.toFixed(3)} EAR at{' '}
                {result.resolution.width} × {result.resolution.height}
              </p>
            )}

            <div className="mt-5 border-t border-slate-800/80 pt-4">
              <button
                type="button"
                disabled
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-teal-500/30 px-4 py-2.5 text-sm font-semibold text-teal-200/70 disabled:cursor-not-allowed"
              >
                <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Run calibration in Live Monitoring</span>
              </button>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Calibration requires active tracking, one visible face, and fresh
                results. It is held in memory only, is discarded when the camera or
                resolution changes, and must be repeated after every page reload.
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
              Event history, prolonged-closure duration, and sound preferences are
              stored with Dexie/IndexedDB in this browser. They do not automatically
              sync and can be removed by clearing browser data. Calibration is never
              persisted.
            </p>

            {alerts.storageStatus === 'error' && alerts.storageError && (
              <p
                className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-200"
                role="status"
              >
                Storage error: {alerts.storageError} Monitoring continues without
                reliable persistence.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => alerts.exportJSON()}
                disabled={alerts.events.length === 0}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Export events as JSON</span>
              </button>

              <button
                type="button"
                onClick={() => alerts.exportCSV()}
                disabled={alerts.events.length === 0}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Export events as CSV</span>
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
                onClick={() => setConfirmingDelete(true)}
                disabled={confirmingDelete}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Delete local data</span>
              </button>
            </div>

            {confirmingDelete && (
              <div
                className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100"
                role="alertdialog"
                aria-label="Confirm deleting all local data"
              >
                <p>
                  Delete all {alerts.events.length} events and reset saved settings?
                  Calibration is already session-only. This cannot be undone.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="min-h-[36px] rounded-md border border-slate-600 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-700/50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAll()}
                    disabled={deleting}
                    className="min-h-[36px] rounded-md bg-red-500 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                  >
                    {deleting ? 'Deleting…' : 'Delete all'}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Exports contain metadata only. Import remains unimplemented so unknown
              files cannot overwrite this browser&apos;s settings.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
