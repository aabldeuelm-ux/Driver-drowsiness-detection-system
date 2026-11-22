import {Check, Cpu, Laptop, RotateCcw} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';

interface CameraSourceSelectorProps {
  selectedCamera: CameraSource;
  onSelectCamera: (source: CameraSource) => void;
}

export function CameraSourceSelector({
  selectedCamera,
  onSelectCamera,
}: CameraSourceSelectorProps) {
  const handleToggleSource = (source: Exclude<CameraSource, null>) => {
    onSelectCamera(selectedCamera === source ? null : source);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-300 sm:text-sm">
          Camera source
        </span>
        {selectedCamera !== null && (
          <button
            type="button"
            onClick={() => onSelectCamera(null)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Clear selection</span>
          </button>
        )}
      </div>

      <div
        role="group"
        aria-label="Camera source selector"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <button
          type="button"
          onClick={() => handleToggleSource('this-device')}
          aria-pressed={selectedCamera === 'this-device'}
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
            selectedCamera === 'this-device'
              ? 'border-teal-500/70 bg-teal-500/10 text-slate-100'
              : 'border-slate-800 bg-[#0B1221] text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                selectedCamera === 'this-device'
                  ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                  : 'border-slate-700/80 bg-slate-800/70 text-slate-400'
              }`}
            >
              <Laptop className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">
                This device
              </span>
              <span className="block text-xs text-slate-400">
                Built-in camera or connected webcam
              </span>
            </div>
          </div>

          {selectedCamera === 'this-device' && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500 text-slate-950">
              <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleToggleSource('esp32-cam')}
          aria-pressed={selectedCamera === 'esp32-cam'}
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
            selectedCamera === 'esp32-cam'
              ? 'border-teal-500/70 bg-teal-500/10 text-slate-100'
              : 'border-slate-800 bg-[#0B1221] text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                selectedCamera === 'esp32-cam'
                  ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                  : 'border-slate-700/80 bg-slate-800/70 text-slate-400'
              }`}
            >
              <Cpu className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">
                ESP32-CAM
              </span>
              <span className="block text-xs text-slate-400">
                Local Wi-Fi camera module
              </span>
            </div>
          </div>

          {selectedCamera === 'esp32-cam' && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500 text-slate-950">
              <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
