import {useCallback, useRef, useState} from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CameraOff,
  CirclePause,
  CircleSlash,
  Crosshair,
  Eye,
  Gauge,
  Play,
  RefreshCw,
  Square,
  Timer,
  Video,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import {useAlerts} from '../alerts/AlertsContext';
import {audioStatusLabel, audioStatusTone} from '../alerts/audioManager';
import {useCamera} from '../camera/CameraContext';
import {useTracking} from '../vision/TrackingContext';
import type {
  GuidedCalibrationState,
  TrackingFrameSource,
} from '../vision/faceTrackingController';
import {CameraSourceSelector} from './CameraSourceSelector';
import {DeviceCameraVideo} from './DeviceCameraVideo';
import {EyeLandmarkOverlay} from './EyeLandmarkOverlay';
import {FaceSelectionOverlay} from './FaceSelectionOverlay';
import {HardwareAlertPanel} from './HardwareAlertPanel';
import {StatusBadge} from './StatusBadge';

function formatEAR(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value.toFixed(3)
    : '—';
}

function formatRatio(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value.toFixed(3)
    : '—';
}

function guidedStepLabel(step: GuidedCalibrationState['step']): string {
  const labels: Record<GuidedCalibrationState['step'], string> = {
    idle: 'Not started',
    collecting: 'Collecting',
    success: 'Calibration complete',
    failed: 'Needs retry',
  };
  return labels[step];
}

function formatSampleSummary(
  summary: {count: number; mean: number; min: number; max: number} | null | undefined,
): string {
  if (!summary || summary.count === 0) return 'No samples yet';
  return `n=${summary.count} · mean ${formatEAR(summary.mean)} · range ${formatEAR(
    summary.min,
  )}–${formatEAR(summary.max)}`;
}

export function LiveMonitoringScreen() {
  const {
    selectedCamera,
    state,
    startCamera,
    stopCamera,
    selectDevice,
    retryCamera,
    activeStatus,
    activeResolution,
  } = useCamera();
  const tracking = useTracking();
  const alerts = useAlerts();
  const frameRef = useRef<TrackingFrameSource | null>(null);
  const [drawLandmarks, setDrawLandmarks] = useState(false);
  const [mirrorPreview, setMirrorPreview] = useState(true);

  const handleVideoElement = useCallback((video: HTMLVideoElement | null) => {
    frameRef.current = video;
  }, []);

  const isThisDevice = selectedCamera === 'this-device';
  const showVideo =
    isThisDevice && state.status === 'live' && state.stream !== null;
  const showFrame = showVideo;
  const cameraLive = activeStatus === 'live' && showFrame;
  const resolutionLabel =
    activeResolution && activeStatus === 'live'
      ? `${activeResolution.width} × ${activeResolution.height}`
      : '—';

  const canStartCamera =
    selectedCamera !== null &&
    activeStatus !== 'live' &&
    activeStatus !== 'requesting';
  const canStopCamera =
    activeStatus === 'live' || activeStatus === 'requesting';
  const canSelectDevice =
    isThisDevice && state.status === 'live' && state.devices.length > 0;

  const trackingPhase = tracking.state.phase;
  const calibration = tracking.state.calibration;
  const mouthBaseline = tracking.state.mouthBaseline;
  const guidedCalibration = tracking.state.guidedCalibration;
  const monitoring = tracking.state.monitoring;
  const yawn = tracking.state.yawn;
  const faceCandidates = tracking.state.faceCandidates;
  const showFaceSelection = faceCandidates.length > 1 || tracking.state.selectedFaceId !== null;
  const closureDiagnostics = tracking.state.closureDiagnostics;
  const hasFreshResults =
    tracking.state.lastInferenceAgeMs !== null &&
    tracking.state.lastInferenceAgeMs < 1000;
  const canCalibrateNow =
    trackingPhase === 'running' &&
    tracking.state.facePresence === 'single' &&
    tracking.state.selectionPrompt === null &&
    tracking.state.staleReason === null &&
    hasFreshResults;
  const canStartCalibration =
    cameraLive && canCalibrateNow && guidedCalibration.step !== 'collecting';
  const canStartMonitoring =
    cameraLive &&
    canCalibrateNow &&
    calibration.result !== null &&
    !monitoring.active;
  const canStartTracking =
    cameraLive && (trackingPhase === 'off' || trackingPhase === 'ready');
  const canStopTracking =
    selectedCamera !== null &&
    (trackingPhase === 'running' || trackingPhase === 'paused' || trackingPhase === 'error');
  const canRetryTracking =
    cameraLive && tracking.state.error?.retryable === true;

  const fpsLabel =
    tracking.state.fpsPhase === 'warming-up'
      ? 'Measuring…'
      : tracking.state.inferenceFps === null
        ? '—'
        : `${tracking.state.inferenceFps.toFixed(1)} fps`;
  const freshnessLabel =
    tracking.state.lastFrameAgeMs === null
      ? '—'
      : `${(tracking.state.lastFrameAgeMs / 1000).toFixed(1)} s ago`;
  const inferenceAgeLabel =
    tracking.state.lastInferenceAgeMs === null
      ? '—'
      : `${(tracking.state.lastInferenceAgeMs / 1000).toFixed(1)} s ago`;
  const closureLabel = monitoring.active
    ? `${(monitoring.closureMs / 1000).toFixed(2)} s`
    : '—';

  const dropdownPlaceholder =
    state.status === 'live'
      ? state.devices.length > 0
        ? 'Select a video input'
        : 'No video-input devices listed'
      : 'Start camera to list video inputs';

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
              Local face tracking, one-click eye and relaxed-mouth calibration,
              experimental bilateral closure measurement, and possible-yawn
              alerts are available here. This is not a diagnosis or a safety
              device.
            </p>
          </div>

          <StatusBadge
            icon={<CirclePause className="h-3.5 w-3.5" />}
            label={tracking.state.statusLabel}
            tone={tracking.state.tone}
          />
        </div>

        {/* Large camera preview */}
        <div className="relative mt-4 min-h-[220px] w-full overflow-hidden rounded-lg border border-slate-700/80 bg-[#090F1D] sm:mt-5 sm:aspect-video">
          {showFrame ? (
            <>
              {showVideo && state.stream ? (
                <DeviceCameraVideo
                  stream={state.stream}
                  className="absolute inset-0 h-full w-full bg-black object-cover"
                  mirrored={mirrorPreview}
                  onVideoElement={handleVideoElement}
                />
              ) : null}
              <EyeLandmarkOverlay
                landmarks={tracking.state.landmarks}
                videoSize={tracking.state.videoSize}
                mirrored={mirrorPreview}
                visible={drawLandmarks && trackingPhase === 'running'}
              />
              {showFaceSelection && (
                <FaceSelectionOverlay
                  candidates={faceCandidates}
                  videoSize={tracking.state.videoSize}
                  mirrored={mirrorPreview}
                  onSelect={tracking.selectFace}
                />
              )}
              <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
                <StatusBadge
                  icon={<Video className="h-3.5 w-3.5" />}
                  label="Camera live"
                  tone="teal"
                />
                {trackingPhase !== 'off' && (
                  <StatusBadge
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label={tracking.state.statusLabel}
                    tone={tracking.state.tone}
                  />
                )}
                {(trackingPhase === 'running' || trackingPhase === 'error') && (
                  <StatusBadge
                    icon={<Eye className="h-3.5 w-3.5" />}
                    label={tracking.state.faceLabel}
                    tone={tracking.state.faceTone}
                  />
                )}
              </div>
              <div className="absolute right-3 bottom-3 flex flex-wrap justify-end gap-2">
                <StatusBadge
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label={yawn.label}
                  tone={yawn.tone}
                />
                <span className="inline-flex items-center rounded-md border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 text-xs font-medium text-slate-300 backdrop-blur-sm">
                  Experimental EAR
                </span>
                <span className="inline-flex items-center rounded-md border border-slate-700/80 bg-slate-950/70 px-2.5 py-1 font-mono text-xs text-slate-300 backdrop-blur-sm">
                  {resolutionLabel}
                </span>
              </div>
            </>
          ) : (
            <div className="flex min-h-[220px] w-full flex-col items-center justify-center border border-dashed border-slate-700/80 px-5 py-8 text-center sm:absolute sm:inset-0 sm:min-h-0 sm:px-6 sm:py-10">
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
                {activeStatus === 'error' ? (
                  <AlertTriangle className="h-6 w-6 text-amber-400" aria-hidden="true" />
                ) : (
                  <CameraOff className="h-6 w-6" aria-hidden="true" />
                )}
              </div>

              <p className="mt-4 text-base font-medium text-slate-100 sm:text-lg">
                {state.status === 'requesting'
                  ? 'Waiting for camera permission…'
                  : state.status === 'error'
                    ? 'Camera preview unavailable.'
                    : 'Ready to preview this device.'}
              </p>

              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
                {state.status === 'idle' &&
                  'Click Start camera for a video-only muted preview, then choose your external camera from the available list.'}
                {state.status === 'requesting' &&
                  'Approve the browser permission prompt, or click Stop camera to cancel the pending request.'}
                {state.status === 'error' &&
                  (state.error?.message ?? 'The camera could not be started.')}
              </p>

              {activeStatus === 'error' && (
                <button
                  type="button"
                  onClick={() => void retryCamera()}
                  className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Retry camera</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Source selector + Available camera dropdown */}
        <div className="mt-5 space-y-5">
          <CameraSourceSelector />

          <div className="space-y-1.5">
            <label
              htmlFor="available-camera-select"
              className="block text-xs font-medium text-slate-300 sm:text-sm"
            >
              Available camera
            </label>
            <select
              id="available-camera-select"
              value={state.selectedDeviceId ?? ''}
              onChange={(event) => void selectDevice(event.target.value)}
              disabled={!canSelectDevice}
              className="min-h-[44px] w-full rounded-lg border border-slate-800 bg-[#0B1221] px-3.5 py-2.5 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-75"
            >
              <option value="">{dropdownPlaceholder}</option>
              {state.devices.map((device, index) => (
                <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              {canSelectDevice
                ? 'Switching cameras stops the previous video tracks and clears face tracking.'
                : 'Video-input devices are listed after camera permission is granted and a preview is live.'}
            </p>
          </div>

          {(showFaceSelection || tracking.state.selectionPrompt) && (
            <section
              aria-labelledby="face-selection-heading"
              className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5"
            >
              <h3
                id="face-selection-heading"
                className="text-sm font-medium text-slate-200"
              >
                Person to monitor
              </h3>
              {tracking.state.selectionPrompt && (
                <p
                  role="status"
                  className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-200"
                >
                  {tracking.state.selectionPrompt}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                Choose a numbered face in the preview or below. Tracking uses
                position across frames only; it never stores face identity.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {faceCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => tracking.selectFace(candidate.id)}
                    aria-pressed={tracking.state.selectedFaceId === candidate.id}
                    className={`inline-flex min-h-[44px] items-center rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                      tracking.state.selectedFaceId === candidate.id
                        ? 'border-teal-400/60 bg-teal-500/20 text-teal-100'
                        : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Face {candidate.number}
                    {candidate.ambiguous ? ' · ambiguous' : ''}
                  </button>
                ))}
              </div>
              {faceCandidates.length === 0 && tracking.state.selectionPrompt && (
                <p className="mt-2 text-xs text-slate-400">
                  No face is available to select right now.
                </p>
              )}
            </section>
          )}

          <HardwareAlertPanel idPrefix="live" />

          {/* Camera, face-tracking, and placeholder controls */}
          <div className="space-y-3 border-t border-slate-800/80 pt-4">
            <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={!canStartCamera}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-500/30 disabled:text-teal-200/70"
              >
                <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start camera</span>
              </button>

              <button
                type="button"
                onClick={stopCamera}
                disabled={!canStopCamera}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-70"
              >
                <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Stop camera</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const source = frameRef.current;
                  if (source) void tracking.startTracking(source);
                }}
                disabled={!canStartTracking}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-500/30 disabled:text-teal-200/70"
              >
                <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start tracking</span>
              </button>

              <button
                type="button"
                onClick={tracking.stopTracking}
                disabled={!canStopTracking}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-70"
              >
                <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Stop tracking</span>
              </button>

              {canRetryTracking && (
                <button
                  type="button"
                  onClick={() => void tracking.retryTracking()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Retry model</span>
                </button>
              )}

              <button
                type="button"
                onClick={tracking.startCalibration}
                disabled={!canStartCalibration}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-4 py-2.5 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Calibrate</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (
                    alerts.settings.sound.enabled &&
                    alerts.audio.status !== 'ready'
                  ) {
                    void alerts.enableSound();
                  }
                  tracking.startMonitoring();
                }}
                disabled={!canStartMonitoring}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-teal-500/30 disabled:text-teal-200/70"
              >
                <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Start monitoring</span>
              </button>

              <button
                type="button"
                onClick={tracking.stopMonitoring}
                disabled={!monitoring.active}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Stop monitoring</span>
              </button>

              <button
                type="button"
                onClick={() => void alerts.testSound()}
                disabled={
                  !alerts.settingsHydrated ||
                  alerts.audio.muted ||
                  alerts.audio.status === 'unsupported'
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Test sound</span>
              </button>

              <button
                type="button"
                onClick={() => void alerts.testSound('possible-yawn')}
                disabled={
                  !alerts.settingsHydrated ||
                  alerts.audio.muted ||
                  alerts.audio.status === 'unsupported'
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Test yawn sound</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <label className="flex min-h-[28px] items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={drawLandmarks}
                  onChange={(event) => setDrawLandmarks(event.target.checked)}
                  className="h-4 w-4 accent-teal-500"
                />
                Draw eye landmarks
              </label>
              <label className="flex min-h-[28px] items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={mirrorPreview}
                  onChange={(event) => setMirrorPreview(event.target.checked)}
                  className="h-4 w-4 accent-teal-500"
                />
                Mirror preview
              </label>
            </div>

            {(guidedCalibration.step !== 'idle' || calibration.result !== null) && (
              <div className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    Calibration
                  </span>
                  <StatusBadge
                    icon={<Crosshair className="h-3.5 w-3.5" />}
                    label={guidedStepLabel(guidedCalibration.step)}
                    tone={
                      guidedCalibration.step === 'success'
                        ? 'teal'
                        : guidedCalibration.step === 'idle'
                          ? 'neutral'
                          : 'amber'
                    }
                  />
                </div>

                {guidedCalibration.instruction && (
                  <p className="mt-3 text-xs leading-relaxed text-slate-300">
                    {guidedCalibration.instruction}
                  </p>
                )}

                {(guidedCalibration.step === 'collecting' ||
                  guidedCalibration.step === 'success') && (
                  <div className="mt-2">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
                      role="progressbar"
                      aria-label="Calibration progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(guidedCalibration.progress * 100)}
                    >
                      <div
                        className="h-full rounded-full bg-teal-500 transition-[width]"
                        style={{width: `${Math.round(guidedCalibration.progress * 100)}%`}}
                      />
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-slate-400">
                      Eyes {guidedCalibration.eyesReady ? 'ready' : 'collecting'} ·
                      Mouth {guidedCalibration.mouthReady ? 'ready' : 'collecting'} ·
                      Samples {mouthBaseline.sampleCount}
                    </p>
                  </div>
                )}

                {guidedCalibration.failure && (
                  <p className="mt-2 text-xs leading-relaxed text-amber-300">
                    {guidedCalibration.failure}
                  </p>
                )}

                {calibration.result && (
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-400">
                    Left {calibration.result.left.threshold.toFixed(3)} EAR ·
                    Right {calibration.result.right.threshold.toFixed(3)} EAR ·
                    {calibration.result.resolution.width} ×{' '}
                    {calibration.result.resolution.height}
                    {mouthBaseline.relaxedOpening !== null &&
                      ` · relaxed mouth ${mouthBaseline.relaxedOpening.toFixed(3)}`}
                  </p>
                )}
              </div>
            )}

            {calibration.result !== null && (
              <section
                aria-labelledby="calibration-diagnostics-heading"
                className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    id="calibration-diagnostics-heading"
                    className="text-sm font-medium text-slate-200"
                  >
                    Calibration diagnostics
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    Measurement age{' '}
                    {tracking.state.lastInferenceAgeMs === null
                      ? '—'
                      : `${(tracking.state.lastInferenceAgeMs / 1000).toFixed(1)} s`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Eye samples are collected together with the relaxed-mouth
                  baseline. Blink-affected frames are skipped. The closure
                  reference is derived from this session's open-eye samples.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {(['left', 'right'] as const).map((eye) => {
                    const diagnostic = closureDiagnostics[eye];
                    const resultEye = calibration.result?.[eye];
                    const openSummary = resultEye?.openSummary
                      ? formatSampleSummary(resultEye.openSummary)
                      : calibration.step === 'collecting'
                        ? `n=${calibration.openSampleCount} · collecting…`
                        : calibration.openSampleCount > 0
                          ? `n=${calibration.openSampleCount} · baseline complete`
                          : 'No samples yet';
                    const closureReference = resultEye
                      ? formatEAR(resultEye.closedMean)
                      : 'Derived after sampling';
                    const classificationClass =
                      diagnostic.classification === 'closed'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : diagnostic.classification === 'open'
                          ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                          : 'border-slate-700 bg-slate-800/60 text-slate-400';

                    return (
                      <div
                        key={eye}
                        className="rounded-md border border-slate-800 bg-[#0A1120] p-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-200">
                            {eye === 'left' ? 'Left eye (subject)' : 'Right eye (subject)'}
                          </span>
                          <span className="font-mono text-xs text-slate-100">
                            {formatEAR(diagnostic.ear)} EAR
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-400">Classification</span>
                          <span
                            className={`rounded border px-1.5 py-0.5 font-medium capitalize ${classificationClass}`}
                          >
                            {diagnostic.classification}
                          </span>
                        </div>
                        <dl className="mt-1.5 space-y-1 text-[11px]">
                          <div className="flex flex-wrap justify-between gap-x-2">
                            <dt className="text-slate-500">Open-eye samples</dt>
                            <dd className="font-mono text-slate-300">{openSummary}</dd>
                          </div>
                          <div className="flex flex-wrap justify-between gap-x-2">
                            <dt className="text-slate-500">Closure reference</dt>
                            <dd className="font-mono text-slate-300">{closureReference}</dd>
                          </div>
                          <div className="flex flex-wrap justify-between gap-x-2">
                            <dt className="text-slate-500">Blinks skipped</dt>
                            <dd className="font-mono text-slate-300">
                              {calibration.skippedBlinkSamples}
                            </dd>
                          </div>
                          <div className="flex flex-wrap justify-between gap-x-2">
                            <dt className="text-slate-500">Close / reopen</dt>
                            <dd className="font-mono text-slate-200">
                              {formatEAR(diagnostic.closeThreshold)} /{' '}
                              {formatEAR(diagnostic.reopenThreshold)}
                            </dd>
                          </div>
                        </dl>
                        {diagnostic.withinHysteresis && (
                          <p className="mt-1.5 text-[10px] leading-snug text-amber-300/90">
                            Above close threshold but inside the hysteresis band;
                            a second frame above reopen clears this state.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(monitoring.active || yawn.status !== 'not-calibrated') && (
              <section
                aria-labelledby="yawn-diagnostics-heading"
                className="rounded-lg border border-slate-800 bg-[#0B1221] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    id="yawn-diagnostics-heading"
                    className="text-sm font-medium text-slate-200"
                  >
                    Possible-Yawn Diagnostics
                  </h3>
                  <StatusBadge
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label={yawn.label}
                    tone={yawn.tone}
                  />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  A sustained mouth opening above the calibrated high threshold
                  creates one browser-only alert. This is not drowsiness
                  classification or a confirmed medical yawn.
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-slate-800 bg-[#0A1120] p-2.5">
                    <dt className="text-[11px] text-slate-500">Opening ratio</dt>
                    <dd className="mt-0.5 font-mono text-sm text-slate-100">
                      {formatRatio(yawn.opening)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-[#0A1120] p-2.5">
                    <dt className="text-[11px] text-slate-500">Alert threshold</dt>
                    <dd className="mt-0.5 font-mono text-sm text-slate-100">
                      {formatRatio(yawn.openThreshold)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-slate-800 bg-[#0A1120] p-2.5">
                    <dt className="text-[11px] text-slate-500">Rearm threshold</dt>
                    <dd className="mt-0.5 font-mono text-sm text-slate-100">
                      {formatRatio(yawn.closeThreshold)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            {tracking.state.error && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-relaxed text-amber-200/90">
                {tracking.state.error.message}
              </div>
            )}

            <p className="text-xs leading-relaxed text-slate-400">
              Calibration stores numeric eye thresholds and a relaxed-mouth
              baseline in memory only; repeat it after a reload, camera change,
              or face change. Monitoring measures continuous bilateral closure
              and possible sustained mouth opening. Metadata-only events stay in
              this browser. Visual monitoring continues if audio or storage
              fails.
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
            Session &amp; Tracking State
          </h2>

          <ul className="mt-4 divide-y divide-slate-800/80">
            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-1">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <CirclePause className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Session status</span>
              </span>
              <StatusBadge
                icon={<CirclePause className="h-3.5 w-3.5" />}
                label={tracking.state.statusLabel}
                tone={tracking.state.tone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Camera className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Camera connection</span>
              </span>
              <StatusBadge
                icon={<Camera className="h-3.5 w-3.5" />}
                label={state.statusLabel}
                tone={state.tone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Video className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Camera resolution</span>
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                {resolutionLabel}
              </span>
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Face tracking</span>
              </span>
              <StatusBadge
                icon={<Activity className="h-3.5 w-3.5" />}
                label={tracking.state.faceLabel}
                tone={tracking.state.faceTone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Crosshair className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Eye calibration</span>
              </span>
              <StatusBadge
                icon={<Crosshair className="h-3.5 w-3.5" />}
                label={tracking.state.calibrationLabel}
                tone={tracking.state.calibrationTone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Eye className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Visual state</span>
              </span>
              <StatusBadge
                icon={<Eye className="h-3.5 w-3.5" />}
                label={tracking.state.monitoringLabel}
                tone={monitoring.tone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Possible yawn</span>
              </span>
              <StatusBadge
                icon={<Activity className="h-3.5 w-3.5" />}
                label={yawn.label}
                tone={yawn.tone}
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Drowsiness classification</span>
              </span>
              <StatusBadge
                icon={<CircleSlash className="h-3.5 w-3.5" />}
                label="Not implemented"
              />
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 last:pb-1">
              <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <WifiOff className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>ESP32 alert device</span>
              </span>
              <StatusBadge
                icon={<WifiOff className="h-3.5 w-3.5" />}
                label={
                  !alerts.hardwareAlertReady
                    ? 'Not configured'
                    : alerts.hardwareAlertsEnabled
                      ? `${alerts.hardwareTransport === 'usb' ? 'USB' : 'Wi-Fi'} · enabled`
                      : `${alerts.hardwareTransport === 'usb' ? 'USB' : 'Wi-Fi'} · ready`
                }
                tone={alerts.hardwareAlertReady ? 'teal' : 'neutral'}
              />
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="sound-alerts-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="sound-alerts-heading"
              className="text-base font-semibold tracking-tight text-slate-100"
            >
              Sound Alerts
            </h2>
            <StatusBadge
              icon={<Volume2 className="h-3.5 w-3.5" />}
              label={audioStatusLabel(alerts.audio)}
              tone={audioStatusTone(alerts.audio)}
            />
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            One short sound per new prolonged-closure episode and a distinct
            pattern per sustained possible-yawn episode. Eye and yawn sounds never
            overlap; blinks and tracking problems stay visual-only. Audio needs an
            explicit click after reload.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-800 bg-[#0B1221] px-3 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={alerts.audio.muted}
                onChange={(event) => alerts.setMuted(event.target.checked)}
                className="h-4 w-4 accent-teal-500"
              />
              <VolumeX className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              Mute alert sound
            </label>

            <div className="space-y-1">
              <label
                htmlFor="live-sound-volume-range"
                className="block text-xs font-medium text-slate-300"
              >
                Alert volume ({alerts.audio.volume}%)
              </label>
              <div className="flex min-h-[36px] items-center rounded-lg border border-slate-800 bg-[#0B1221] px-3">
                <input
                  id="live-sound-volume-range"
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

          {alerts.audio.status !== 'ready' &&
            alerts.audio.status !== 'unsupported' && (
            <button
              type="button"
              onClick={() => void alerts.enableSound()}
              className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
            >
              <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Enable sound
            </button>
          )}

          {alerts.audio.message && (
            <p
              className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200"
              role="status"
            >
              {alerts.audio.message}
            </p>
          )}

          {alerts.storageError && (
            <p
              className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200"
              role="status"
            >
              Storage error: {alerts.storageError} Visual monitoring continues.
            </p>
          )}
        </section>

        <section
          aria-labelledby="live-measurements-heading"
          className="rounded-xl border border-slate-800/90 bg-[#10192D] p-4 sm:p-5"
        >
          <h2
            id="live-measurements-heading"
            className="text-base font-semibold tracking-tight text-slate-100"
          >
            Eye Measurements
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            EAR is an experimental geometric measurement, not a probability or
            diagnosis.
          </p>

          <dl className="mt-4 divide-y divide-slate-800/80">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Eye className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Tracking status</span>
              </dt>
              <dd>
                <StatusBadge
                  icon={<Eye className="h-3.5 w-3.5" />}
                  label={tracking.state.faceLabel}
                  tone={tracking.state.faceTone}
                />
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Eye className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Left eye EAR</span>
              </dt>
              <dd className="flex items-center gap-2 font-mono text-base font-semibold tabular-nums text-slate-100">
                {formatEAR(tracking.state.measurements?.leftEAR ?? null)}
                {monitoring.leftClosed && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-300">
                    closed
                  </span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Eye className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Right eye EAR</span>
              </dt>
              <dd className="flex items-center gap-2 font-mono text-base font-semibold tabular-nums text-slate-100">
                {formatEAR(tracking.state.measurements?.rightEAR ?? null)}
                {monitoring.rightClosed && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-300">
                    closed
                  </span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Timer className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Eye-closure duration</span>
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-slate-100">
                {closureLabel}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Timer className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Prolonged threshold</span>
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-slate-100">
                {tracking.prolongedClosureMs} ms
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Gauge className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Inference FPS</span>
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-slate-100">
                {fpsLabel}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3 py-3 last:pb-1">
              <dt className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                <Activity className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>Frame freshness</span>
              </dt>
              <dd
                className="font-mono text-base font-semibold tabular-nums text-slate-100"
                title={`Camera frame: ${freshnessLabel}; last completed inference: ${inferenceAgeLabel}`}
              >
                {freshnessLabel}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
