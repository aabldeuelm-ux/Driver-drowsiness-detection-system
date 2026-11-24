import type {StatusTone} from '../types/dashboard';
import {
  CALIBRATION_INSTRUCTION,
  calibrationLabel as labelForCalibration,
  createInitialCalibrationState,
  CalibrationEngine,
  type CalibrationFailureReason,
  type CalibrationResult,
  type CalibrationState,
} from './calibration';
import {createMediaPipeFaceLandmarker} from './createMediaPipeFaceLandmarker';
import {calculateEyeEARs} from './earGeometry';
import {
  createFaceTrackState,
  landmarksToFaceBox,
  trackFaces,
  type FaceBox,
} from './faceTracker';
import {
  CLOSURE_MAX_SAMPLE_GAP_MS,
  createInitialMonitoringState,
  DEFAULT_PROLONGED_CLOSURE_MS,
  EyeClosureMonitor,
  type MonitoringInterruption,
  type MonitoringState,
} from './eyeClosureMonitor';
import {
  createInitialMouthBaselineState,
  MouthBaselineEngine,
  type MouthBaselineState,
} from './mouthBaseline';
import {calculateMouthOpening} from './mouthOpening';
import {
  createYawnConfig,
  YawnMonitor,
  type YawnMonitorConfig,
  type YawnMonitorPhase,
} from './yawnMonitor';

export type TrackingPhase =
  | 'off'
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'error';

export type FacePresence =
  | 'unknown'
  | 'none'
  | 'single'
  | 'multiple'
  | 'stale'
  | 'hidden'
  | 'error';

export type StaleReason = 'camera-frames-stopped' | 'inference-stalled';
export type FpsPhase = 'idle' | 'warming-up' | 'measuring';

export type TrackingErrorCode =
  | 'model-download'
  | 'unsupported'
  | 'runtime'
  | 'stale-frames';

export interface TrackingError {
  code: TrackingErrorCode;
  message: string;
  retryable: boolean;
}

export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface FaceLandmarkerResultLike {
  faceLandmarks?: readonly (readonly LandmarkLike[])[] | null;
}

export interface VideoLike {
  currentTime: number;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}

/** Either a live video element or a canvas carrying snapshot-frame metadata. */
export type TrackingFrameSource = VideoLike & object;

export interface FaceLandmarkerLike {
  detectForVideo(video: VideoLike, timestamp: number): FaceLandmarkerResultLike;
  close(): void;
}

export interface FrameInfo {
  /** Monotonically increasing frame identity, used only for deduplication. */
  frameId: number;
  /** Media presentation time in seconds; may be zero for live sources. */
  mediaTime: number;
}

export type FrameCallback = (frame: FrameInfo) => void;

export interface FrameScheduler {
  request(video: VideoLike, callback: FrameCallback): number;
  cancel(video: VideoLike, handle: number): void;
  /**
   * Optional handoff used to keep synchronous MediaPipe calls off the frame
   * callback. Test schedulers omit it and run inline for deterministic checks.
   */
  defer?(callback: () => void): void;
}

export interface VideoSize {
  width: number;
  height: number;
}

export interface EyeMeasurements {
  leftEAR: number | null;
  rightEAR: number | null;
  capturedAt: number;
}

export type ClosureClassification = 'open' | 'closed' | 'unavailable';

export interface ClosureEyeDiagnostic {
  ear: number | null;
  closeThreshold: number | null;
  reopenThreshold: number | null;
  classification: ClosureClassification;
  /** Above the close threshold but below the reopen threshold. */
  withinHysteresis: boolean;
}

export interface ClosureDiagnostics {
  left: ClosureEyeDiagnostic;
  right: ClosureEyeDiagnostic;
}

/** Geometric, per-frame face marker. No appearance or biometric data is kept. */
export interface FaceCandidate {
  id: number;
  number: number;
  box: FaceBox;
  selected: boolean;
  ambiguous: boolean;
}

export interface GuidedCalibrationState {
  step: 'idle' | 'collecting' | 'success' | 'failed';
  instruction: string;
  /** 0..1 across the single combined sampling session. */
  progress: number;
  eyesReady: boolean;
  mouthReady: boolean;
  failure: string | null;
}

export type YawnStatus =
  | 'not-calibrated'
  | 'ready'
  | 'watching'
  | 'candidate'
  | 'detected'
  | 'paused';

export interface YawnState {
  status: YawnStatus;
  label: string;
  tone: StatusTone;
  opening: number | null;
  openThreshold: number | null;
  closeThreshold: number | null;
}

export interface YawnAlert {
  id: string;
  startedAt: number;
  durationMs: number;
}

export interface FaceTrackingState {
  phase: TrackingPhase;
  statusLabel: string;
  tone: StatusTone;
  error: TrackingError | null;
  facePresence: FacePresence;
  faceLabel: string;
  /** Tracking-only tone; closure severity must not change this badge. */
  faceTone: StatusTone;
  staleReason: StaleReason | null;
  measurements: EyeMeasurements | null;
  landmarks: readonly LandmarkLike[] | null;
  /** Visible faces in stable numeric ID order, for selection UI and markers. */
  faceCandidates: FaceCandidate[];
  selectedFaceId: number | null;
  /** Set when the selected face is lost or its identity is ambiguous. */
  selectionPrompt: string | null;
  videoSize: VideoSize | null;
  inferenceFps: number | null;
  fpsPhase: FpsPhase;
  lastFrameAgeMs: number | null;
  lastInferenceAgeMs: number | null;
  lastFrameArrivalAtMs: number | null;
  lastInferenceCompletedAtMs: number | null;
  frameTimestampMs: number | null;
  /** Every badge in the app reads one of these controller-derived labels. */
  calibrationLabel: string;
  calibrationTone: StatusTone;
  monitoringLabel: string;
  calibration: CalibrationState;
  mouthBaseline: MouthBaselineState;
  guidedCalibration: GuidedCalibrationState;
  monitoring: MonitoringState;
  yawn: YawnState;
  yawnAlert: YawnAlert | null;
  closureDiagnostics: ClosureDiagnostics;
  prolongedClosureMs: number;
}

type StateListener = (state: FaceTrackingState) => void;

const PHASE_LABELS: Record<TrackingPhase, string> = {
  off: 'Tracking not started',
  loading: 'Loading model…',
  ready: 'Model ready',
  running: 'Tracking running',
  paused: 'Tracking paused: page hidden',
  error: 'Tracking error',
};

const FACE_LABELS: Record<FacePresence, string> = {
  unknown: 'Tracking not started',
  none: 'No face detected',
  single: 'One face detected',
  multiple: 'Monitoring problem: multiple faces',
  stale: 'Monitoring problem: frame stale',
  hidden: 'Tracking paused: page hidden',
  error: 'Waiting for a successful result',
};

const STALE_LABELS: Record<StaleReason, string> = {
  'camera-frames-stopped': 'Monitoring problem: camera frames stopped',
  'inference-stalled': 'Monitoring problem: inference stalled',
};

function emptyEyeDiagnostic(): ClosureEyeDiagnostic {
  return {
    ear: null,
    closeThreshold: null,
    reopenThreshold: null,
    classification: 'unavailable',
    withinHysteresis: false,
  };
}

function emptyClosureDiagnostics(): ClosureDiagnostics {
  return {left: emptyEyeDiagnostic(), right: emptyEyeDiagnostic()};
}

function idleGuidedCalibration(): GuidedCalibrationState {
  return {
    step: 'idle',
    instruction: '',
    progress: 0,
    eyesReady: false,
    mouthReady: false,
    failure: null,
  };
}

function idleYawnState(): YawnState {
  return {
    status: 'not-calibrated',
    label: 'Possible yawn: not calibrated',
    tone: 'neutral',
    opening: null,
    openThreshold: null,
    closeThreshold: null,
  };
}

const DEFAULT_STATE: FaceTrackingState = {
  phase: 'off',
  statusLabel: PHASE_LABELS.off,
  tone: 'neutral',
  error: null,
  facePresence: 'unknown',
  faceLabel: FACE_LABELS.unknown,
  faceTone: 'neutral',
  staleReason: null,
  measurements: null,
  landmarks: null,
  faceCandidates: [],
  selectedFaceId: null,
  selectionPrompt: null,
  videoSize: null,
  inferenceFps: null,
  fpsPhase: 'idle',
  lastFrameAgeMs: null,
  lastInferenceAgeMs: null,
  lastFrameArrivalAtMs: null,
  lastInferenceCompletedAtMs: null,
  frameTimestampMs: null,
  calibrationLabel: 'Not calibrated',
  calibrationTone: 'neutral',
  monitoringLabel: 'Not calibrated',
  calibration: createInitialCalibrationState(),
  mouthBaseline: createInitialMouthBaselineState(),
  guidedCalibration: idleGuidedCalibration(),
  monitoring: createInitialMonitoringState(),
  yawn: idleYawnState(),
  yawnAlert: null,
  closureDiagnostics: emptyClosureDiagnostics(),
  prolongedClosureMs: DEFAULT_PROLONGED_CLOSURE_MS,
};

const FPS_WINDOW_MS = 2000;
const FPS_WARMUP_MS = 500;
const FPS_WARMUP_SAMPLES = 2;
const DEFAULT_STALE_AFTER_MS = 1000;
const FRESHNESS_INTERVAL_MS = 250;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface RequestVideoFrameCapableVideo extends VideoLike {
  requestVideoFrameCallback?: (
    callback: (
      now: number,
      metadata: {mediaTime?: number; presentedFrames?: number},
    ) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/**
 * Uses `presentedFrames` as the frame identity where available. The rvfc spec
 * allows `mediaTime` to be zero for live sources, so it is not a safe sole
 * deduplication key for a webcam stream.
 */
class VideoFrameScheduler implements FrameScheduler {
  request(video: VideoLike, callback: FrameCallback): number {
    const capable = video as RequestVideoFrameCapableVideo;

    if (typeof capable.requestVideoFrameCallback === 'function') {
      return capable.requestVideoFrameCallback((_now, metadata) => {
        const mediaTime = isFiniteNumber(metadata.mediaTime)
          ? metadata.mediaTime
          : video.currentTime;
        const presentedFrames = isFiniteNumber(metadata.presentedFrames)
          ? metadata.presentedFrames
          : null;
        const frameId =
          presentedFrames !== null && presentedFrames > 0
            ? presentedFrames
            : mediaTime > 0
              ? mediaTime
              : video.currentTime;

        callback({frameId, mediaTime});
      });
    }

    return requestAnimationFrame(() => {
      const time = video.currentTime;
      callback({frameId: time, mediaTime: time});
    });
  }

  cancel(video: VideoLike, handle: number): void {
    const capable = video as RequestVideoFrameCapableVideo;
    if (typeof capable.cancelVideoFrameCallback === 'function') {
      capable.cancelVideoFrameCallback(handle);
      return;
    }
    cancelAnimationFrame(handle);
  }

  /** Yields once so JPEG decode/timers can run between inference calls. */
  defer(callback: () => void): void {
    setTimeout(callback, 0);
  }
}

export function mapTrackingError(error: unknown): TrackingError {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLowerCase();

  if (
    /fetch|network|failed to load|could not load|404|offline|modelasset|model file/.test(
      normalized,
    )
  ) {
    return {
      code: 'model-download',
      message:
        'Could not download the face-tracking model. Check your internet connection for the first load, then retry. Camera frames are never uploaded.',
      retryable: true,
    };
  }

  if (/wasm|webassembly|webgl|not supported|unsupported/.test(normalized)) {
    return {
      code: 'unsupported',
      message:
        'This browser could not start MediaPipe WebAssembly. Try a current version of Safari, Chrome, or Firefox.',
      retryable: false,
    };
  }

  return {
    code: 'runtime',
    message:
      'Face tracking could not start. Check the browser console, then retry.',
    retryable: true,
  };
}

function createStaleError(reason: StaleReason): TrackingError {
  return {
    code: 'stale-frames',
    message:
      reason === 'camera-frames-stopped'
        ? 'Camera frames stopped arriving. Check the camera preview; measurements will return when fresh frames arrive.'
        : 'Camera frames are arriving, but inference is not completing. Tracking will keep trying with fresh frames; check browser performance if this continues.',
    retryable: false,
  };
}

function toneFor(phase: TrackingPhase, face: FacePresence): StatusTone {
  if (phase === 'error' || face === 'multiple' || face === 'stale' || face === 'error') {
    return 'red';
  }
  if (
    phase === 'loading' ||
    phase === 'paused' ||
    face === 'none' ||
    face === 'hidden'
  ) {
    return 'amber';
  }
  if (phase === 'running' && face === 'single') return 'teal';
  return 'neutral';
}

/** Single source of truth for all user-facing tracking labels and tone. */
function deriveLabels(state: FaceTrackingState): Pick<
  FaceTrackingState,
  | 'statusLabel'
  | 'faceLabel'
  | 'faceTone'
  | 'calibrationLabel'
  | 'calibrationTone'
  | 'monitoringLabel'
  | 'tone'
> {
  const calibrationLabel = labelForCalibration(state.calibration);
  const calibrationTone: StatusTone =
    state.calibration.step === 'failed'
      ? 'red'
      : state.calibration.step === 'success'
        ? 'teal'
        : state.calibration.step === 'collecting' ||
            state.calibration.step === 'cancelled'
          ? 'amber'
          : 'neutral';
  const monitoringLabel = state.monitoring.reasonLabel
    ? `${state.monitoring.label} — ${state.monitoring.reasonLabel}`
    : state.monitoring.label;
  const faceLabel =
    state.selectionPrompt ??
    (state.staleReason
      ? STALE_LABELS[state.staleReason]
      : FACE_LABELS[state.facePresence]);

  const monitoringVisible =
    state.monitoring.active || state.monitoring.status === 'unavailable';
  const monitoringPhase =
    state.phase === 'running' || state.phase === 'paused';

  let statusLabel = PHASE_LABELS[state.phase];
  if (state.phase === 'running') {
    if (monitoringVisible) {
      statusLabel = monitoringLabel;
    } else if (
      state.calibration.step === 'failed' ||
      state.calibration.step === 'cancelled'
    ) {
      statusLabel = labelForCalibration(state.calibration);
    } else if (state.calibration.step === 'collecting') {
      statusLabel = calibrationLabel;
    } else if (state.calibration.step === 'success') {
      statusLabel = 'Ready';
    }
  }
  if (state.phase === 'paused' && monitoringVisible) {
    statusLabel = monitoringLabel;
  }

  // Face badges use this tracking-only tone. Closure severity changes the
  // session status badge, never the "One face detected" badge.
  let faceTone = toneFor(state.phase, state.facePresence);
  if (state.selectionPrompt && !state.staleReason) faceTone = 'amber';
  let tone = faceTone;
  if (state.staleReason || state.calibration.step === 'failed') tone = 'red';
  if (state.calibration.step === 'cancelled') tone = 'amber';
  if (state.phase === 'paused') tone = 'amber';
  if (monitoringPhase && monitoringVisible) {
    tone = state.monitoring.tone;
  }

  return {
    statusLabel,
    faceLabel,
    faceTone,
    calibrationLabel,
    calibrationTone,
    monitoringLabel,
    tone,
  };
}

/**
 * Presents the eye and mouth baselines as one calibration session. The two
 * engines keep their own threshold objects; this only derives shared UI state.
 */
function deriveGuidedCalibration(
  calibration: CalibrationState,
  mouth: MouthBaselineState,
): GuidedCalibrationState {
  const eyesReady = calibration.step === 'success' && calibration.result !== null;
  const mouthReady =
    mouth.step === 'success' && mouth.relaxedOpening !== null;
  const failure =
    calibration.failure?.message ?? mouth.failure?.message ?? null;

  if (eyesReady && mouthReady) {
    return {
      step: 'success',
      instruction: 'Calibration complete.',
      progress: 1,
      eyesReady,
      mouthReady,
      failure: null,
    };
  }
  if (
    calibration.step === 'failed' ||
    mouth.step === 'failed' ||
    calibration.step === 'cancelled'
  ) {
    return {
      step: 'failed',
      instruction: failure ?? 'Calibration was interrupted. Click Calibrate to try again.',
      progress: (calibration.progress + mouth.progress) / 2,
      eyesReady,
      mouthReady,
      failure,
    };
  }
  if (
    calibration.step === 'collecting' ||
    mouth.step === 'collecting'
  ) {
    return {
      step: 'collecting',
      instruction: CALIBRATION_INSTRUCTION,
      progress: (calibration.progress + mouth.progress) / 2,
      eyesReady,
      mouthReady,
      failure: null,
    };
  }
  return {
    ...idleGuidedCalibration(),
    eyesReady,
    mouthReady,
  };
}

function yawnLabel(
  config: YawnMonitorConfig | null,
  phase: YawnMonitorPhase,
  active: boolean,
): Pick<YawnState, 'status' | 'label' | 'tone'> {
  if (!config) {
    return {
      status: 'not-calibrated',
      label: 'Possible yawn: not calibrated',
      tone: 'neutral',
    };
  }
  if (!active) {
    return {status: 'ready', label: 'Possible yawn: start monitoring', tone: 'neutral'};
  }
  if (phase === 'active') {
    return {status: 'detected', label: 'Possible yawn detected', tone: 'amber'};
  }
  if (phase === 'candidate') {
    return {status: 'candidate', label: 'Possible yawn: watching opening', tone: 'amber'};
  }
  return {status: 'watching', label: 'Possible yawn: watching', tone: 'teal'};
}

/**
 * Diagnostics always describe the same EAR result that produced the UI overlay.
 * When monitoring is active they reuse the monitor's classified state; otherwise
 * they show a simple close-threshold comparison without implying a session.
 */
function deriveClosureDiagnostics(
  state: FaceTrackingState,
): ClosureDiagnostics {
  const result = state.calibration.result;
  const measurements = state.measurements;

  const build = (
    eye: 'left' | 'right',
    monitorClosed: boolean,
  ): ClosureEyeDiagnostic => {
    const calibrated = result?.[eye];
    const rawEAR = eye === 'left' ? measurements?.leftEAR : measurements?.rightEAR;
    const ear = isFiniteNumber(rawEAR) ? rawEAR : null;
    const closeThreshold = calibrated?.threshold ?? null;
    const reopenThreshold = calibrated?.reopenThreshold ?? null;
    let classification: ClosureClassification = 'unavailable';
    if (ear !== null && closeThreshold !== null) {
      classification = state.monitoring.active
        ? monitorClosed
          ? 'closed'
          : 'open'
        : ear <= closeThreshold
          ? 'closed'
          : 'open';
    }
    const withinHysteresis =
      classification === 'closed' &&
      ear !== null &&
      closeThreshold !== null &&
      reopenThreshold !== null &&
      ear > closeThreshold &&
      ear <= reopenThreshold;
    return {
      ear,
      closeThreshold,
      reopenThreshold,
      classification,
      withinHysteresis,
    };
  };

  return {
    left: build('left', state.monitoring.leftClosed),
    right: build('right', state.monitoring.rightClosed),
  };
}

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export interface FaceTrackingControllerOptions {
  createLandmarker?: () => Promise<FaceLandmarkerLike>;
  scheduler?: FrameScheduler;
  now?: () => number;
  staleAfterMs?: number;
}

/**
 * Owns MediaPipe model loading and the inference loop. It has no React or
 * rendering dependencies so cancellation, staleness, and cleanup can be tested
 * directly.
 */
export class FaceTrackingController {
  private state: FaceTrackingState = {...DEFAULT_STATE};
  private readonly listeners = new Set<StateListener>();
  private readonly createLandmarker: () => Promise<FaceLandmarkerLike>;
  private readonly scheduler: FrameScheduler;
  private readonly now: () => number;
  private readonly staleAfterMs: number;

  private landmarker: FaceLandmarkerLike | null = null;
  private video: VideoLike | null = null;
  private sessionId = 0;
  private disposed = false;
  private active = false;
  private hidden = isPageHidden();
  private inFlight = false;
  private frameHandle: number | null = null;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;

  private lastProcessedFrameId: number | null = null;
  private lastTimestampMs = 0;
  private lastFrameArrivalAt: number | null = null;
  private lastInferenceCompletedAt: number | null = null;
  private waitingSince: number | null = null;
  private inferenceWaitStartedAt: number | null = null;
  private completedInferenceTimestamps: number[] = [];
  private consecutiveInferenceErrors = 0;

  private readonly calibrationEngine = new CalibrationEngine();
  private readonly mouthBaselineEngine = new MouthBaselineEngine();
  private readonly closureMonitor = new EyeClosureMonitor();
  private readonly yawnMonitor = new YawnMonitor(createYawnConfig(0.15));
  private faceTrackState = createFaceTrackState();
  private selectedFaceId: number | null = null;
  private currentFaceId: number | null = null;
  /** Spatial-only track ID whose samples may enter the current calibration. */
  private calibrationFaceId: number | null = null;
  private selectionPrompt: string | null = null;
  /** Resumes a paused session only after a reselected face is reaffirmed. */
  private pendingResumeAfterReaffirm = false;
  private yawnConfig: YawnMonitorConfig | null = null;
  private lastMouthOpening: number | null = null;
  private yawnSeq = 0;
  private monitoringRequested = false;
  private lastVideoSize: VideoSize | null = null;
  private appliedCalibrationResult: CalibrationResult | null = null;

  constructor(options: FaceTrackingControllerOptions = {}) {
    this.createLandmarker =
      options.createLandmarker ?? createMediaPipeFaceLandmarker;
    this.scheduler = options.scheduler ?? new VideoFrameScheduler();
    this.now = options.now ?? (() => performance.now());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  getState(): FaceTrackingState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-enable the controller after a Strict Mode simulated remount. */
  revive(): void {
    this.disposed = false;
    this.emit();
  }

  async start(video: VideoLike): Promise<void> {
    if (this.disposed || this.active) return;

    this.video = video;
    this.hidden = isPageHidden();
    this.active = true;
    const sessionId = ++this.sessionId;
    this.resetFrameData();

    if (!this.landmarker) {
      this.patch({
        ...this.clearedMeasurements(),
        phase: 'loading',
        statusLabel: PHASE_LABELS.loading,
        tone: 'amber',
        error: null,
        facePresence: 'unknown',
        faceLabel: FACE_LABELS.unknown,
      });

      let landmarker: FaceLandmarkerLike;
      try {
        landmarker = await this.createLandmarker();
      } catch (error) {
        if (this.isStale(sessionId)) return;
        this.active = false;
        const mapped = mapTrackingError(error);
        this.patch({
          ...this.clearedMeasurements(),
          phase: 'error',
          statusLabel: PHASE_LABELS.error,
          tone: 'red',
          error: mapped,
          facePresence: 'error',
          faceLabel: FACE_LABELS.error,
        });
        return;
      }

      if (this.isStale(sessionId)) {
        landmarker.close();
        return;
      }
      this.landmarker = landmarker;
    }

    if (this.isStale(sessionId)) return;

    // Start the freshness clock only once inference can actually begin.
    this.resetFrameData();
    this.waitingSince = this.now();

    const phase: TrackingPhase = this.hidden ? 'paused' : 'running';
    const facePresence: FacePresence = this.hidden ? 'hidden' : 'unknown';
    this.patch({
      ...this.clearedMeasurements(),
      phase,
      statusLabel: PHASE_LABELS[phase],
      tone: toneFor(phase, facePresence),
      facePresence,
      faceLabel: FACE_LABELS[facePresence],
      error: null,
      fpsPhase: this.hidden ? 'idle' : 'warming-up',
    });

    if (!this.hidden) {
      this.startFreshnessTimer();
      this.scheduleFrame();
    }
  }

  retry(): Promise<void> {
    if (!this.video) return Promise.resolve();
    const video = this.video;
    this.stopSession();
    return this.start(video);
  }

  private currentResolution(): VideoSize {
    return {
      width: this.video?.videoWidth ?? 0,
      height: this.video?.videoHeight ?? 0,
    };
  }

  private calibrationBlocker(): CalibrationFailureReason | null {
    if (!this.canRun() || this.state.phase !== 'running') {
      return 'tracking-not-active';
    }
    if (this.state.facePresence !== 'single' || this.state.selectionPrompt !== null) {
      return 'face-not-single';
    }
    if (this.state.staleReason !== null) return 'stale-results';
    const age = this.state.lastInferenceAgeMs;
    if (age === null || age > this.staleAfterMs) return 'stale-results';
    const measurements = this.state.measurements;
    if (
      !measurements ||
      !isFiniteNumber(measurements.leftEAR) ||
      !isFiniteNumber(measurements.rightEAR)
    ) {
      return 'stale-results';
    }
    return null;
  }

  /**
   * One-click calibration. A completed baseline is reused when only the other
   * baseline still needs samples; otherwise both engines start fresh.
   */
  startCalibration(): void {
    this.monitoringRequested = false;
    this.pendingResumeAfterReaffirm = false;
    this.closureMonitor.stop();
    this.clearYawnEpisode();
    const blocker = this.calibrationBlocker();
    if (blocker) {
      this.calibrationEngine.failFor(blocker);
      this.syncEngineStates();
      return;
    }

    const atMs = this.now();
    const resolution = this.currentResolution();
    const eyesReady = this.calibrationEngine.getState().result !== null;
    const mouthReady =
      this.mouthBaselineEngine.getState().relaxedOpening !== null;
    this.calibrationFaceId = this.currentFaceId ?? this.selectedFaceId;

    if (eyesReady && mouthReady) {
      this.calibrationEngine.begin(atMs, resolution, this.calibrationFaceId);
      this.mouthBaselineEngine.begin(atMs, this.calibrationFaceId);
    } else {
      this.calibrationEngine.resume(atMs, resolution, this.calibrationFaceId);
      this.mouthBaselineEngine.resume(atMs, this.calibrationFaceId);
    }
    this.syncEngineStates();
  }

  /** Brief interruptions pause collection but keep valid face samples. */
  private pauseCalibration(
    atMs: number,
    reason: CalibrationFailureReason = 'face-not-single',
  ): void {
    this.calibrationEngine.onInterruption(reason, atMs);
    this.mouthBaselineEngine.onInterruption('tracking-gap', atMs);
  }

  /**
   * A different or ambiguous selected face invalidates both baselines. The
   * user must start calibration again for the newly selected face.
   */
  private invalidateCalibrationForFaceChange(): void {
    this.calibrationEngine.invalidateForFaceChange();
    this.mouthBaselineEngine.invalidate('face-selection-changed');
    this.calibrationFaceId = null;
    this.closureMonitor.setCalibration(null);
    this.appliedCalibrationResult = null;
    this.monitoringRequested = false;
    this.pendingResumeAfterReaffirm = false;
    this.clearYawnEpisode();
    this.yawnConfig = null;
    this.yawnMonitor.setConfig(createYawnConfig(0.15));
  }

  /**
   * Selects a face by its spatial track ID. No appearance, embedding, or other
   * biometric identity is stored. Selecting a different person discards
   * calibration; reaffirming the current person resumes a paused session.
   */
  selectFace(faceId: number): void {
    const previous = this.selectedFaceId ?? this.currentFaceId;
    const changed = previous !== null && previous !== faceId;
    const reaffirmingPausedFace = this.selectionPrompt !== null;
    this.selectedFaceId = faceId;
    this.selectionPrompt = null;

    if (changed) {
      this.invalidateCalibrationForFaceChange();
      this.closureMonitor.interrupt('face-not-visible');
    } else {
      // A paused session resumes only after the next frame confirms that the
      // reselected face is uniquely visible.
      this.pendingResumeAfterReaffirm =
        this.monitoringRequested && reaffirmingPausedFace;
      this.resumeMonitoringIfRequested();
    }
    this.syncEngineStates();
  }

  startMonitoring(): void {
    this.monitoringRequested = true;
    this.pendingResumeAfterReaffirm = false;
    this.applyCalibrationToMonitor();
    if (!this.calibrationEngine.getState().result) {
      this.syncEngineStates();
      return;
    }
    const blocker = this.calibrationBlocker();
    if (blocker) {
      const reason: MonitoringInterruption =
        blocker === 'face-not-single'
          ? 'face-not-visible'
          : blocker === 'stale-results'
            ? 'stale-frames'
            : 'tracking-stopped';
      this.closureMonitor.failStart(reason);
      this.syncEngineStates();
      return;
    }
    this.closureMonitor.start(this.now());
    this.syncEngineStates();
  }

  stopMonitoring(): void {
    this.monitoringRequested = false;
    this.pendingResumeAfterReaffirm = false;
    this.closureMonitor.stop();
    this.clearYawnEpisode();
    this.syncEngineStates();
  }

  setProlongedClosureMs(value: number): void {
    this.closureMonitor.setProlongedClosureMs(value);
    this.patch({
      prolongedClosureMs: this.closureMonitor.getProlongedClosureMs(),
    });
  }

  invalidateCalibration(
    reason: 'camera-changed' | 'resolution-changed',
  ): void {
    this.calibrationEngine.invalidate(reason);
    this.mouthBaselineEngine.invalidate(
      reason === 'camera-changed' ? 'face-selection-changed' : 'unstable-mouth',
    );
    this.calibrationFaceId = null;
    this.closureMonitor.setCalibration(null);
    this.appliedCalibrationResult = null;
    this.clearYawnEpisode();
    this.yawnConfig = null;
    this.yawnMonitor.setConfig(createYawnConfig(0.15));
    this.monitoringRequested = false;
    this.pendingResumeAfterReaffirm = false;
    if (reason === 'camera-changed') {
      this.selectedFaceId = null;
      this.currentFaceId = null;
      this.faceTrackState = createFaceTrackState();
    }
    this.syncEngineStates();
  }

  /**
   * Publishes the derived calibration result to the closure monitor exactly
   * once per result object. This keeps thresholds separate per eye without
   * resetting an active monitoring session on every frame.
   */
  private applyCalibrationToMonitor(): void {
    const result = this.calibrationEngine.getState().result;
    if (result === this.appliedCalibrationResult) return;
    this.closureMonitor.setCalibration(result);
    this.appliedCalibrationResult = result;
  }

  private engineStates(): Pick<
    FaceTrackingState,
    | 'calibration'
    | 'mouthBaseline'
    | 'guidedCalibration'
    | 'monitoring'
    | 'yawn'
    | 'yawnAlert'
  > {
    this.applyCalibrationToMonitor();
    const calibration = this.calibrationEngine.getState();
    const mouthBaseline = this.mouthBaselineEngine.getState();
    const monitoring = this.closureMonitor.getState();
    return {
      calibration,
      mouthBaseline,
      guidedCalibration: deriveGuidedCalibration(calibration, mouthBaseline),
      monitoring,
      yawn: {
        ...yawnLabel(this.yawnConfig, this.yawnMonitor.getSnapshot().phase, monitoring.active),
        opening: this.lastMouthOpening,
        openThreshold: this.yawnConfig?.openThreshold ?? null,
        closeThreshold: this.yawnConfig?.closeThreshold ?? null,
      },
      yawnAlert: this.state.yawnAlert,
    };
  }

  private clearYawnEpisode(): void {
    this.yawnMonitor.reset();
  }

  private clearYawnForLostFace(): void {
    this.clearYawnEpisode();
    this.lastMouthOpening = null;
    this.yawnConfig = this.mouthBaselineEngine.getState().relaxedOpening === null
      ? null
      : this.yawnConfig;
  }

  private hasUsableMouthBaseline(): boolean {
    return (
      this.calibrationEngine.getState().result !== null &&
      this.mouthBaselineEngine.getState().step === 'success' &&
      this.mouthBaselineEngine.getState().relaxedOpening !== null
    );
  }

  private configureYawnFromBaseline(): void {
    if (!this.hasUsableMouthBaseline()) return;
    const relaxed = this.mouthBaselineEngine.getState().relaxedOpening ?? 0.15;
    const next = createYawnConfig(relaxed);
    if (
      this.yawnConfig?.openThreshold === next.openThreshold &&
      this.yawnConfig?.closeThreshold === next.closeThreshold
    ) {
      return;
    }
    this.yawnConfig = next;
    this.yawnMonitor.setConfig(next);
  }

  private resumeMonitoringIfRequested(
    current?: Pick<
      FaceTrackingState,
      | 'facePresence'
      | 'selectionPrompt'
      | 'staleReason'
      | 'lastInferenceAgeMs'
      | 'measurements'
    >,
  ): void {
    if (!this.monitoringRequested) return;
    // Eye-closure monitoring is independent of yawning calibration; a failed
    // mouth stage must not silently pause an existing eye session.
    if (!this.calibrationEngine.getState().result) return;
    const facePresence = current ? current.facePresence : this.state.facePresence;
    const selectionPrompt = current
      ? current.selectionPrompt
      : this.state.selectionPrompt;
    const staleReason = current ? current.staleReason : this.state.staleReason;
    if (facePresence !== 'single' || selectionPrompt !== null || staleReason !== null) {
      return;
    }
    const age = current?.lastInferenceAgeMs ?? this.state.lastInferenceAgeMs;
    if (age === null || age > this.staleAfterMs) return;
    const measurements = current?.measurements ?? this.state.measurements;
    if (
      !measurements ||
      !isFiniteNumber(measurements.leftEAR) ||
      !isFiniteNumber(measurements.rightEAR)
    ) {
      return;
    }
    this.closureMonitor.stop();
    this.closureMonitor.start(this.now());
  }

  private syncEngineStates(): void {
    this.patch(this.engineStates());
  }

  stopSession(): void {
    this.sessionId += 1;
    this.active = false;
    this.cancelFrame();
    this.clearFreshnessTimer();
    this.resetFrameData();
    this.lastVideoSize = null;
    this.monitoringRequested = false;
    this.pendingResumeAfterReaffirm = false;
    this.closureMonitor.stop();
    this.clearYawnForLostFace();
    this.selectedFaceId = null;
    this.currentFaceId = null;
    this.calibrationFaceId = null;
    this.faceTrackState = createFaceTrackState();
    if (this.calibrationEngine.getState().step === 'collecting') {
      this.calibrationEngine.failFor('tracking-stopped');
    }
    if (this.mouthBaselineEngine.getState().step === 'collecting') {
      this.mouthBaselineEngine.invalidate('cancelled');
    }

    const phase: TrackingPhase = this.landmarker
      ? this.hidden
        ? 'paused'
        : 'ready'
      : this.state.error
        ? 'error'
        : 'off';
    const facePresence: FacePresence = this.hidden ? 'hidden' : 'unknown';

    this.patch({
      ...this.clearedMeasurements(),
      phase,
      statusLabel: PHASE_LABELS[phase],
      tone: toneFor(phase, facePresence),
      facePresence,
      faceLabel: FACE_LABELS[facePresence],
      error: phase === 'error' ? this.state.error : null,
      calibration: this.calibrationEngine.getState(),
      monitoring: this.closureMonitor.getState(),
    });
  }

  setPageVisible(visible: boolean): void {
    const nextHidden = !visible;
    if (nextHidden === this.hidden) return;
    this.hidden = nextHidden;

    if (!this.active || this.state.phase === 'loading') return;

    if (this.hidden) {
      this.sessionId += 1;
      this.cancelFrame();
      this.clearFreshnessTimer();
      this.resetFrameData();
      this.pendingResumeAfterReaffirm = false;
      this.closureMonitor.interrupt('page-hidden');
      this.calibrationEngine.onInterruption('page-hidden', this.now());
      this.mouthBaselineEngine.onInterruption('tracking-gap', this.now());
      this.clearYawnForLostFace();
      this.patch({
        ...this.clearedMeasurements(),
        phase: 'paused',
        statusLabel: PHASE_LABELS.paused,
        tone: 'amber',
        facePresence: 'hidden',
        faceLabel: FACE_LABELS.hidden,
        error: null,
        calibration: this.calibrationEngine.getState(),
        monitoring: this.closureMonitor.getState(),
      });
      return;
    }

    this.sessionId += 1;
    this.resetFrameData();
    this.waitingSince = this.now();
    this.patch({
      ...this.clearedMeasurements(),
      phase: 'running',
      statusLabel: PHASE_LABELS.running,
      tone: 'neutral',
      facePresence: 'unknown',
      faceLabel: FACE_LABELS.unknown,
      error: null,
      fpsPhase: 'warming-up',
    });
    this.startFreshnessTimer();
    this.scheduleFrame();
  }

  /** Exposed for the freshness timer and focused tests. */
  refreshFreshness(): void {
    // Safari may throttle timers without dispatching visibilitychange promptly.
    if (isPageHidden() && !this.hidden) {
      this.setPageVisible(false);
      return;
    }
    if (!this.active || this.hidden || this.waitingSince === null) return;

    const now = this.now();
    const frameAge =
      this.lastFrameArrivalAt === null
        ? now - this.waitingSince
        : now - this.lastFrameArrivalAt;
    const inferenceAge =
      this.lastInferenceCompletedAt !== null
        ? now - this.lastInferenceCompletedAt
        : this.inferenceWaitStartedAt !== null
          ? now - this.inferenceWaitStartedAt
          : 0;

    if (
      this.lastInferenceCompletedAt !== null &&
      inferenceAge > CLOSURE_MAX_SAMPLE_GAP_MS
    ) {
      this.closureMonitor.interrupt('inference-gap');
      this.calibrationEngine.onInterruption('tracking-gap', now);
      this.mouthBaselineEngine.onInterruption('tracking-gap', now);
      this.clearYawnForLostFace();
    }

    this.patch({
      lastFrameAgeMs: Math.max(0, frameAge),
      lastInferenceAgeMs: Math.max(0, inferenceAge),
      calibration: this.calibrationEngine.getState(),
      monitoring: this.closureMonitor.getState(),
    });

    if (frameAge > this.staleAfterMs) {
      this.markStale('camera-frames-stopped', frameAge);
      return;
    }
    if (inferenceAge > this.staleAfterMs) {
      this.markStale('inference-stalled', inferenceAge);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.sessionId += 1;
    this.active = false;
    this.cancelFrame();
    this.clearFreshnessTimer();
    this.resetFrameData();
    this.landmarker?.close();
    this.landmarker = null;
    this.video = null;
    this.lastVideoSize = null;
    this.calibrationEngine.cancel();
    this.mouthBaselineEngine.reset();
    this.closureMonitor.setCalibration(null);
    this.clearYawnForLostFace();
    this.appliedCalibrationResult = null;
    this.state = {...DEFAULT_STATE};
    this.emit();
  }

  private canRun(): boolean {
    return (
      this.active &&
      !this.disposed &&
      !this.hidden &&
      this.video !== null &&
      this.landmarker !== null
    );
  }

  private isStale(sessionId: number): boolean {
    return sessionId !== this.sessionId || !this.active || this.disposed;
  }

  private scheduleFrame(): void {
    if (!this.canRun() || this.inFlight || this.frameHandle !== null || !this.video) {
      return;
    }

    this.frameHandle = this.scheduler.request(this.video, (frame) => {
      this.frameHandle = null;
      if (!this.canRun()) return;

      // All bookkeeping and MediaPipe timestamps use this monotonic clock.
      // Arrival is recorded only after dedupe and readiness checks pass, so a
      // snapshot canvas polled by requestAnimationFrame cannot look fresh on
      // every display refresh while the ESP32 has not sent a new frame.
      this.processFrame(this.now(), frame);
    });
  }

  private noteFrameArrival(arrivedAt: number): void {
    this.lastFrameArrivalAt = arrivedAt;
    if (this.lastInferenceCompletedAt === null && this.inferenceWaitStartedAt === null) {
      this.inferenceWaitStartedAt = arrivedAt;
    }

    this.patch({
      lastFrameArrivalAtMs: Math.round(arrivedAt),
      lastFrameAgeMs: 0,
      lastInferenceAgeMs:
        this.lastInferenceCompletedAt === null
          ? 0
          : Math.max(0, arrivedAt - this.lastInferenceCompletedAt),
    });
  }

  private processFrame(arrivedAt: number, frame: FrameInfo): void {
    if (!this.canRun() || this.inFlight || !this.video || !this.landmarker) return;
    if (!isFiniteNumber(frame.frameId) || !isFiniteNumber(frame.mediaTime)) {
      this.scheduleFrame();
      return;
    }
    if (
      this.lastProcessedFrameId !== null &&
      frame.frameId <= this.lastProcessedFrameId
    ) {
      this.scheduleFrame();
      return;
    }
    if (
      this.video.readyState < 2 ||
      this.video.videoWidth <= 0 ||
      this.video.videoHeight <= 0
    ) {
      this.scheduleFrame();
      return;
    }
    // Only the newest distinct frame is accepted; missing/stale frames are
    // discarded rather than queued or counted as a closed eye.
    this.noteFrameArrival(arrivedAt);
    this.lastProcessedFrameId = frame.frameId;
    this.inFlight = true;
    const sessionId = this.sessionId;
    const runInference = () => {
      if (this.isStale(sessionId)) return;
      if (!this.canRun() || !this.video || !this.landmarker) {
        this.inFlight = false;
        return;
      }

      let result: FaceLandmarkerResultLike | null = null;
      let inferenceError: unknown = null;
      try {
        const timestamp = Math.max(Math.floor(arrivedAt), this.lastTimestampMs + 1);
        this.lastTimestampMs = timestamp;
        result = this.landmarker.detectForVideo(this.video, timestamp);
      } catch (error) {
        inferenceError = error;
      } finally {
        this.inFlight = false;
      }

      if (inferenceError !== null) {
        this.handleInferenceError(inferenceError, arrivedAt);
      } else {
        this.applyResult(result ?? {faceLandmarks: []}, this.now(), arrivedAt);
      }

      // Recoverable errors still continue the single scheduled loop.
      if (this.canRun()) this.scheduleFrame();
    };

    if (this.scheduler.defer) this.scheduler.defer(runInference);
    else runInference();
  }

  private handleInferenceError(error: unknown, frameArrivedAt: number): void {
    const mapped = mapTrackingError(error);
    this.consecutiveInferenceErrors += 1;
    this.clearFrameMeasurements();
    this.completedInferenceTimestamps = [];
    this.closureMonitor.interrupt('inference-gap');
    this.calibrationEngine.onInterruption('tracking-gap');
    this.mouthBaselineEngine.interrupt('tracking-gap');
    this.clearYawnForLostFace();

    if (mapped.code === 'unsupported') {
      this.closureMonitor.failStart('tracking-stopped');
      this.active = false;
      this.cancelFrame();
      this.clearFreshnessTimer();
      this.patch({
        phase: 'error',
        statusLabel: PHASE_LABELS.error,
        tone: 'red',
        error: {...mapped, retryable: false},
        facePresence: 'error',
        faceLabel: FACE_LABELS.error,
        inferenceFps: null,
        fpsPhase: 'idle',
        lastFrameAgeMs: Math.max(0, this.now() - frameArrivedAt),
        calibration: this.calibrationEngine.getState(),
        monitoring: this.closureMonitor.getState(),
      });
      return;
    }

    this.patch({
      phase: 'error',
      statusLabel: PHASE_LABELS.error,
      tone: 'red',
      error: {
        code: 'runtime',
        message:
          'A frame could not be processed. Tracking will retry with the next fresh frame; if this continues, check the browser console.',
        retryable: false,
      },
      facePresence: 'error',
      faceLabel: FACE_LABELS.error,
      inferenceFps: null,
      fpsPhase: 'idle',
      staleReason: null,
      lastFrameAgeMs: Math.max(0, this.now() - frameArrivedAt),
      lastInferenceAgeMs:
        this.lastInferenceCompletedAt === null
          ? 0
          : Math.max(0, this.now() - this.lastInferenceCompletedAt),
      calibration: this.calibrationEngine.getState(),
      monitoring: this.closureMonitor.getState(),
    });
  }

  private applyResult(
    result: FaceLandmarkerResultLike,
    completedAt: number,
    frameArrivedAt: number,
  ): void {
    if (!this.canRun() || !this.video) return;

    this.lastInferenceCompletedAt = completedAt;
    this.inferenceWaitStartedAt = null;
    this.consecutiveInferenceErrors = 0;

    this.completedInferenceTimestamps.push(completedAt);
    this.completedInferenceTimestamps = this.completedInferenceTimestamps.filter(
      (sample) => completedAt - sample <= FPS_WINDOW_MS,
    );

    const firstSample = this.completedInferenceTimestamps[0];
    const lastSample =
      this.completedInferenceTimestamps[this.completedInferenceTimestamps.length - 1];
    const span =
      firstSample !== undefined && lastSample !== undefined
        ? lastSample - firstSample
        : 0;
    const hasWarmWindow =
      this.completedInferenceTimestamps.length >= FPS_WARMUP_SAMPLES &&
      span >= FPS_WARMUP_MS;
    const inferenceFps = hasWarmWindow
      ? Math.round(((this.completedInferenceTimestamps.length - 1) * 1000 * 10) / span) / 10
      : null;
    const fpsPhase: FpsPhase = hasWarmWindow ? 'measuring' : 'warming-up';

    const resolution: VideoSize = {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    };
    if (
      this.lastVideoSize &&
      (this.lastVideoSize.width !== resolution.width ||
        this.lastVideoSize.height !== resolution.height)
    ) {
      this.invalidateCalibration('resolution-changed');
    }
    this.lastVideoSize = resolution;
    this.closureMonitor.setResolution(resolution);

    const base = {
      phase: 'running' as const,
      statusLabel: PHASE_LABELS.running,
      error: null,
      staleReason: null,
      inferenceFps,
      fpsPhase,
      lastFrameAgeMs: Math.max(0, completedAt - frameArrivedAt),
      lastInferenceAgeMs: 0,
      lastFrameArrivalAtMs: Math.round(frameArrivedAt),
      lastInferenceCompletedAtMs: Math.round(completedAt),
      frameTimestampMs: Math.round(frameArrivedAt),
    };

    const faces = result.faceLandmarks ?? [];
    const aspectRatio = resolution.width > 0 && resolution.height > 0
      ? resolution.width / resolution.height
      : 1;

    // Assign MediaPipe result slots to stable spatial tracks. Result order is
    // not treated as identity; only normalized position and size are used.
    const detections: FaceBox[] = [];
    const detectionLandmarks: (readonly LandmarkLike[])[] = [];
    for (const face of faces) {
      const box = landmarksToFaceBox(face);
      if (!box) continue;
      detections.push(box);
      detectionLandmarks.push(face);
    }
    const detectedFaceCount = detections.length;
    const trackingFrame = trackFaces(this.faceTrackState, detections, completedAt, {
      aspectRatio,
    });
    this.faceTrackState = trackingFrame.state;

    const candidates: FaceCandidate[] = trackingFrame.visibleTracks.map((track, index) => ({
      id: track.id,
      number: index + 1,
      box: track.box,
      selected: this.selectedFaceId === track.id,
      ambiguous: trackingFrame.ambiguousTrackIds.includes(track.id),
    }));

    const selectedAssignment =
      this.selectedFaceId === null
        ? null
        : trackingFrame.assignments.find(
            (assignment) => assignment.trackId === this.selectedFaceId,
          ) ?? null;
    const selectedVisible = trackingFrame.visibleTracks.some(
      (track) => track.id === this.selectedFaceId,
    );
    const selectedAmbiguous =
      selectedAssignment?.ambiguous === true ||
      (this.selectedFaceId !== null &&
        trackingFrame.ambiguousTrackIds.includes(this.selectedFaceId));
    const autoSingle =
      this.selectedFaceId === null && detectedFaceCount === 1;

    let landmarks: readonly LandmarkLike[] | null = null;
    let facePresence: FacePresence;
    let prompt: string | null = null;

    if (this.selectedFaceId !== null) {
      if (!selectedVisible || !selectedAssignment) {
        prompt =
          detectedFaceCount === 0
            ? 'Selected face is not visible. Choose a face when it returns.'
            : 'Selected face was lost. Choose a face to resume detection.';
        facePresence = detectedFaceCount === 0 ? 'none' : 'multiple';
      } else if (selectedAmbiguous) {
        prompt = 'Face identity is ambiguous. Choose the same face again.';
        facePresence = 'multiple';
      } else {
        const index = selectedAssignment.detectionIndex;
        landmarks = detectionLandmarks[index] ?? [];
        facePresence = 'single';
        // Keep the reselect prompt visible until the user explicitly reaffirms
        // the face; a paused session must never resume silently.
      }
    } else if (detectedFaceCount === 0) {
      facePresence = 'none';
    } else if (detectedFaceCount > 1) {
      facePresence = 'multiple';
      prompt = 'More than one face is visible. Choose a face to enable detection.';
    } else {
      landmarks = detectionLandmarks[0] ?? [];
      facePresence = 'single';
    }

    this.currentFaceId =
      this.selectedFaceId ??
      (autoSingle ? trackingFrame.visibleTracks[0]?.id ?? null : null);

    const calibrationEngaged =
      this.calibrationFaceId !== null &&
      (this.calibrationEngine.getState().step === 'collecting' ||
        this.mouthBaselineEngine.getState().step === 'collecting' ||
        this.calibrationEngine.getState().result !== null ||
        this.mouthBaselineEngine.getState().relaxedOpening !== null);
    const faceIdentityChanged =
      calibrationEngaged &&
      (selectedAmbiguous ||
        (detectedFaceCount > 1 && this.selectedFaceId === null) ||
        (this.currentFaceId !== null &&
          this.currentFaceId !== this.calibrationFaceId));
    if (faceIdentityChanged) this.invalidateCalibrationForFaceChange();

    const calibrationPaused =
      this.selectionPrompt !== null ||
      prompt !== null ||
      faceIdentityChanged;
    let ears: ReturnType<typeof calculateEyeEARs> | null = null;
    if (facePresence === 'single' && landmarks !== null) {
      ears = calculateEyeEARs(landmarks, resolution.width, resolution.height);
      const opening = calculateMouthOpening(landmarks, aspectRatio);
      this.lastMouthOpening = opening;

      if (isFiniteNumber(ears.leftEAR) && isFiniteNumber(ears.rightEAR)) {
        if (this.pendingResumeAfterReaffirm && prompt === null) {
          const measurements = {
            leftEAR: ears.leftEAR,
            rightEAR: ears.rightEAR,
            capturedAt: completedAt,
          };
          this.pendingResumeAfterReaffirm = false;
          this.resumeMonitoringIfRequested({
            facePresence,
            selectionPrompt: null,
            staleReason: null,
            lastInferenceAgeMs: 0,
            measurements,
          });
        }
        if (calibrationPaused) {
          this.pauseCalibration(completedAt);
        } else {
          this.calibrationEngine.observe(
            {
              leftEAR: ears.leftEAR,
              rightEAR: ears.rightEAR,
              atMs: completedAt,
              faceId: this.currentFaceId,
            },
            resolution,
          );
          this.mouthBaselineEngine.observe({
            atMs: completedAt,
            opening,
            faceId: this.currentFaceId,
            valid: opening !== null,
          });
          if (this.mouthBaselineEngine.getState().step === 'success') {
            this.configureYawnFromBaseline();
          }
        }
        this.closureMonitor.observe({
          leftEAR: ears.leftEAR,
          rightEAR: ears.rightEAR,
          atMs: completedAt,
        });
      } else {
        this.closureMonitor.interrupt('inference-gap');
        this.pauseCalibration(completedAt, 'invalid-sample');
        this.clearYawnForLostFace();
      }

      if (
        this.closureMonitor.getState().active &&
        this.yawnConfig !== null &&
        opening !== null
      ) {
        const event = this.yawnMonitor.handle({now: completedAt, opening});
        if (event) {
          this.yawnSeq += 1;
          this.state = {
            ...this.state,
            yawnAlert: {
              id: `yawn-${Math.round(event.startedAt)}-${this.yawnSeq}`,
              startedAt: event.startedAt,
              durationMs: event.durationMs,
            },
          };
        }
      } else {
        this.yawnMonitor.reset();
      }
    } else {
      this.selectionPrompt = prompt;
      this.clearFrameMeasurements();
      this.lastMouthOpening = null;
      const reason: MonitoringInterruption =
        facePresence === 'multiple' ? 'multiple-faces' : 'face-not-visible';
      this.closureMonitor.interrupt(reason);
      this.pauseCalibration(completedAt, 'face-not-single');
      this.clearYawnForLostFace();
    }

    this.patch({
      ...base,
      ...this.engineStates(),
      facePresence,
      faceLabel: this.selectionPrompt ?? FACE_LABELS[facePresence],
      tone: this.selectionPrompt ? 'amber' : toneFor(base.phase, facePresence),
      faceCandidates: candidates,
      selectedFaceId: this.selectedFaceId,
      selectionPrompt: this.selectionPrompt,
      landmarks,
      videoSize: resolution,
      measurements:
        facePresence === 'single' && landmarks !== null && ears !== null
          ? {leftEAR: ears.leftEAR, rightEAR: ears.rightEAR, capturedAt: completedAt}
          : null,
    });
  }

  private markStale(reason: StaleReason, ageMs: number): void {
    this.clearFrameMeasurements();
    this.completedInferenceTimestamps = [];
    this.pendingResumeAfterReaffirm = false;
    this.closureMonitor.interrupt('stale-frames');
    this.calibrationEngine.onInterruption('stale-results', this.now());
    this.mouthBaselineEngine.onInterruption('tracking-gap', this.now());
    this.clearYawnForLostFace();

    this.patch({
      phase: 'error',
      statusLabel: PHASE_LABELS.error,
      tone: 'red',
      error: createStaleError(reason),
      facePresence: 'stale',
      faceLabel: STALE_LABELS[reason],
      staleReason: reason,
      inferenceFps: null,
      fpsPhase: 'idle',
      lastFrameAgeMs: Math.max(0, ageMs),
      lastFrameArrivalAtMs:
        this.lastFrameArrivalAt === null ? null : Math.round(this.lastFrameArrivalAt),
      lastInferenceCompletedAtMs:
        this.lastInferenceCompletedAt === null
          ? null
          : Math.round(this.lastInferenceCompletedAt),
      calibration: this.calibrationEngine.getState(),
      monitoring: this.closureMonitor.getState(),
    });
  }

  private startFreshnessTimer(): void {
    if (this.freshnessTimer !== null) return;
    this.freshnessTimer = setInterval(
      () => this.refreshFreshness(),
      FRESHNESS_INTERVAL_MS,
    );
  }

  private clearFreshnessTimer(): void {
    if (this.freshnessTimer === null) return;
    clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
  }

  private cancelFrame(): void {
    if (this.frameHandle === null || !this.video) return;
    this.scheduler.cancel(this.video, this.frameHandle);
    this.frameHandle = null;
  }

  private resetFrameData(): void {
    this.inFlight = false;
    this.lastProcessedFrameId = null;
    this.lastTimestampMs = 0;
    this.lastFrameArrivalAt = null;
    this.lastInferenceCompletedAt = null;
    this.waitingSince = null;
    this.inferenceWaitStartedAt = null;
    this.completedInferenceTimestamps = [];
    this.consecutiveInferenceErrors = 0;
  }

  private clearedMeasurements(): Partial<FaceTrackingState> {
    return {
      staleReason: null,
      measurements: null,
      landmarks: null,
      faceCandidates: [],
      selectedFaceId: this.selectedFaceId,
      selectionPrompt: this.selectionPrompt,
      videoSize: null,
      inferenceFps: null,
      fpsPhase: 'idle',
      lastFrameAgeMs: null,
      lastInferenceAgeMs: null,
      lastFrameArrivalAtMs: null,
      lastInferenceCompletedAtMs: null,
      frameTimestampMs: null,
    };
  }

  private clearFrameMeasurements(): void {
    this.state = {
      ...this.state,
      measurements: null,
      landmarks: null,
      faceCandidates: [],
      videoSize: null,
    };
  }

  private patch(partial: Partial<FaceTrackingState>): void {
    this.state = {...this.state, ...partial};
    this.state = {
      ...this.state,
      ...deriveLabels(this.state),
      closureDiagnostics: deriveClosureDiagnostics(this.state),
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
