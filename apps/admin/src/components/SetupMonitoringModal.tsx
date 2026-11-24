import {useEffect} from 'react';
import {
  Activity,
  Camera,
  CircleSlash,
  Cpu,
  Crosshair,
  Eye,
  Info,
  Laptop,
  X,
} from 'lucide-react';
import {useCamera} from '../camera/CameraContext';
import {useTracking} from '../vision/TrackingContext';
import {StatusBadge} from './StatusBadge';

interface SetupMonitoringModalProps {
  open: boolean;
  onOpenLiveMonitoring: () => void;
  onClose: () => void;
}

export function SetupMonitoringModal({
  open,
  onOpenLiveMonitoring,
  onClose,
}: SetupMonitoringModalProps) {
  const {
    selectedCamera,
    selectSource,
    activeStatus,
    activeStatusLabel,
    activeTone,
  } = useCamera();
  const tracking = useTracking();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-modal-title"
    >
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-lg rounded-t-2xl border border-slate-800 bg-[#10192D] p-5 shadow-2xl sm:rounded-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="setup-modal-title"
              className="text-lg font-semibold tracking-tight text-slate-100"
            >
              Set up monitoring
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Review camera and face-tracking prerequisites before opening the
              live preview.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup dialog"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-300">
              1. Camera source
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={() => selectSource('this-device')}
                aria-pressed={selectedCamera === 'this-device'}
                className="flex min-h-[44px] items-center gap-2.5 rounded-lg border border-teal-500/70 bg-teal-500/12 px-3.5 py-2.5 text-left text-sm font-medium text-teal-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <Laptop className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>This device — built-in camera or USB webcam</span>
              </button>
              <p className="text-xs leading-relaxed text-slate-400">
                Start the camera in Live Monitoring, then pick the external
                camera from the available camera list. ESP32 hardware is
                alert-only and configured separately.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-800/80 pt-4">
            <p className="text-xs font-medium text-slate-300">
              2. Required system stages
            </p>
            <ul className="mt-2.5 divide-y divide-slate-800/70">
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Camera className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Camera stream connection</span>
                </span>
                <StatusBadge
                  icon={<Camera className="h-3.5 w-3.5" />}
                  label={activeStatusLabel}
                  tone={activeStatus === 'live' ? activeTone : 'neutral'}
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Cpu className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Face-tracking model</span>
                </span>
                <StatusBadge
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label={tracking.state.statusLabel}
                  tone={tracking.state.tone}
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Eye className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Experimental EAR measurement</span>
                </span>
                <StatusBadge
                  icon={<Eye className="h-3.5 w-3.5" />}
                  label={tracking.state.faceLabel}
                  tone={tracking.state.faceTone}
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Possible yawn</span>
                </span>
                <StatusBadge
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label={tracking.state.yawn.label}
                  tone={tracking.state.yawn.tone}
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <CircleSlash className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Drowsiness classification</span>
                </span>
                <StatusBadge
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not implemented"
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Crosshair className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>One-click baseline calibration</span>
                </span>
                <StatusBadge
                  icon={<Crosshair className="h-3.5 w-3.5" />}
                  label={tracking.state.calibrationLabel}
                  tone={tracking.state.calibrationTone}
                />
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3.5 text-xs leading-relaxed text-amber-200/90">
            <Info
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <p>
              Local webcam monitoring, one-click eye and relaxed-mouth
              calibration, experimental bilateral closure measurement, possible-yawn alerts,
              browser sound and pop-up alerts, and local event history are
              available. The ESP32 is configured separately as an optional
              LED/buzzer eye-closure alert device. Drowsiness classification and
              severity escalation are not implemented.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2.5 border-t border-slate-800/80 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-700/80 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenLiveMonitoring();
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            Open Live Monitoring
          </button>
        </div>
      </div>
    </div>
  );
}
