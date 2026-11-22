import {ArrowRight, CameraOff, VideoOff} from 'lucide-react';
import type {CameraSource} from '../types/dashboard';
import {CameraSourceSelector} from './CameraSourceSelector';
import {StatusBadge} from './StatusBadge';

interface CameraPreviewCardProps {
  selectedCamera: CameraSource;
  onSelectCamera: (source: CameraSource) => void;
  onSetupMonitoring: () => void;
}

export function CameraPreviewCard({
  selectedCamera,
  onSelectCamera,
  onSetupMonitoring,
}: CameraPreviewCardProps) {
  return (
    <section
      aria-labelledby="camera-preview-heading"
      className="flex flex-1 flex-col rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="camera-preview-heading"
            className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
          >
            Camera Preview
          </h2>
          <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
            Preview area for live eye-tracking alignment before a session starts.
          </p>
        </div>

        <StatusBadge
          icon={<VideoOff className="h-3.5 w-3.5" />}
          label="Feed inactive"
          tone="neutral"
        />
      </div>

      {/* Large camera preview placeholder */}
      <div className="relative mt-4 flex min-h-[210px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-700/80 bg-[#090F1D] px-5 py-8 text-center sm:mt-5 sm:aspect-video sm:px-6 sm:py-10">
        {/* Subtle corner calibration marks */}
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
          Choose a camera to begin.
        </p>

        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
          {selectedCamera === null &&
            'Select This device or ESP32-CAM below, then open setup to connect a feed and run eye calibration.'}
          {selectedCamera === 'this-device' &&
            'This device is selected as the source. Camera permissions and model calibration have not been started yet.'}
          {selectedCamera === 'esp32-cam' &&
            'ESP32-CAM is selected as the source. Device pairing and stream verification have not been started yet.'}
        </p>
      </div>

      {/* Camera source selector + primary CTA */}
      <div className="mt-5 space-y-4">
        <CameraSourceSelector
          selectedCamera={selectedCamera}
          onSelectCamera={onSelectCamera}
        />

        <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">
            Detection starts only after camera connection and eye-closure calibration.
          </p>

          <button
            type="button"
            onClick={onSetupMonitoring}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors duration-150 hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10192D] whitespace-nowrap shrink-0 sm:w-auto"
          >
            <span>Set up monitoring</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
