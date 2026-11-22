import {Activity, ArrowRight, CameraOff, Video, VideoOff} from 'lucide-react';
import {useCamera} from '../camera/CameraContext';
import {useTracking} from '../vision/TrackingContext';
import {CameraSourceSelector} from './CameraSourceSelector';
import {StatusBadge} from './StatusBadge';

interface CameraPreviewCardProps {
  onSetupMonitoring: () => void;
}

export function CameraPreviewCard({onSetupMonitoring}: CameraPreviewCardProps) {
  const {activeStatus, activeStatusLabel, activeTone} = useCamera();
  const tracking = useTracking();

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
            Use this device's camera, then start the live preview in Live Monitoring.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            icon={
              activeStatus === 'live' ? (
                <Video className="h-3.5 w-3.5" />
              ) : (
                <VideoOff className="h-3.5 w-3.5" />
              )
            }
            label={activeStatusLabel}
            tone={activeStatus === 'live' ? activeTone : 'neutral'}
          />
          {tracking.state.phase !== 'off' && (
            <StatusBadge
              icon={<Activity className="h-3.5 w-3.5" />}
              label={tracking.state.statusLabel}
              tone={tracking.state.tone}
            />
          )}
        </div>
      </div>

      {/* Large camera preview placeholder; live preview lives on Live Monitoring */}
      <div className="relative mt-4 flex min-h-[210px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-700/80 bg-[#090F1D] px-5 py-8 text-center sm:mt-5 sm:aspect-video sm:px-6 sm:py-10">
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
          Device camera preview is available in Live Monitoring.
        </p>

        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
          Monitoring uses this device. Open Live Monitoring, start the camera,
          choose your built-in or USB webcam from the available camera list, run
          guided calibration, then use Start monitoring for experimental
          bilateral closure measurements. The ESP32 is alert-only and is
          configured separately.
        </p>
      </div>

      {/* Camera source selector + primary CTA */}
      <div className="mt-5 space-y-4">
        <CameraSourceSelector />

        <div className="flex flex-col gap-3 border-t border-slate-800/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">
            Camera preview, face tracking, calibration, and closure measurement
            start only after explicit clicks in Live Monitoring. Drowsiness
            classification remains unimplemented.
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
