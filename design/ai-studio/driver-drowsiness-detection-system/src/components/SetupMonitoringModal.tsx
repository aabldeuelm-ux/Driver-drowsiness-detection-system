import {useEffect} from 'react';
import {
  Camera,
  CircleSlash,
  Cpu,
  Crosshair,
  Info,
  Laptop,
  X,
} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';
import {StatusBadge} from './StatusBadge';

interface SetupMonitoringModalProps {
  open: boolean;
  selectedCamera: CameraSource;
  onSelectCamera: (source: CameraSource) => void;
  onOpenLiveMonitoring: () => void;
  onClose: () => void;
}

export function SetupMonitoringModal({
  open,
  selectedCamera,
  onSelectCamera,
  onOpenLiveMonitoring,
  onClose,
}: SetupMonitoringModalProps) {
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
              Review prerequisites before starting an eye-closure monitoring session.
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
              1. Camera source preference
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onSelectCamera('this-device')}
                aria-pressed={selectedCamera === 'this-device'}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  selectedCamera === 'this-device'
                    ? 'border-teal-500/70 bg-teal-500/12 text-teal-200'
                    : 'border-slate-800 bg-[#0B1221] text-slate-300 hover:border-slate-700'
                }`}
              >
                <Laptop className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>This device</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectCamera('esp32-cam')}
                aria-pressed={selectedCamera === 'esp32-cam'}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  selectedCamera === 'esp32-cam'
                    ? 'border-teal-500/70 bg-teal-500/12 text-teal-200'
                    : 'border-slate-800 bg-[#0B1221] text-slate-300 hover:border-slate-700'
                }`}
              >
                <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>ESP32-CAM</span>
              </button>
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
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not connected"
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Cpu className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Eye-closure detection model</span>
                </span>
                <StatusBadge
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not loaded"
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Crosshair className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>Baseline eye calibration</span>
                </span>
                <StatusBadge
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label="Not completed"
                />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-sm text-slate-300">
                  <Cpu className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>ESP32</span>
                </span>
                <StatusBadge
                  icon={<CircleSlash className="h-3.5 w-3.5" />}
                  label={selectedCamera === 'this-device' ? 'Not required' : 'Not connected'}
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
              This interface prototype shows all admin screens without live camera access, detection, or hardware communication yet.
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
