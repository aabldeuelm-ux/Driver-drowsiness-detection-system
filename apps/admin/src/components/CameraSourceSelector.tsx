import {Check, Laptop, RotateCcw} from 'lucide-react';
import {useCamera} from '../camera/CameraContext';

export function CameraSourceSelector() {
  const {selectSource} = useCamera();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-300 sm:text-sm">
          Camera source
        </span>
        <button
          type="button"
          onClick={() => selectSource('this-device')}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Switch camera
        </button>
      </div>
      <div className="flex min-h-[56px] items-center justify-between gap-3 rounded-lg border border-teal-500/70 bg-teal-500/10 px-4 py-3 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 text-teal-300">
            <Laptop className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-medium text-slate-100">
              This device
            </span>
            <span className="block text-xs text-slate-400">
              Built-in camera or connected USB webcam
            </span>
          </div>
        </div>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500 text-slate-950">
          <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
        </span>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        Click <span className="font-medium text-slate-300">Switch camera</span>{' '}
        to stop the current stream, then use Start camera and the available
        camera list to choose your external webcam. ESP32 hardware is alert-only
        and configured separately.
      </p>
    </div>
  );
}
