/**
 * Session-only, in-memory eye calibration.
 *
 * The user performs one short session: look at the camera, relax the mouth,
 * and blink normally. Both the open-eye baseline and the relaxed-mouth baseline
 * are sampled together by their respective engines; this engine only handles
 * the eye half. Normal blinks, talking, and brief tracking gaps are skipped
 * rather than treated as failures, while valid samples from the selected face
 * stay in the window.
 *
 * The close threshold is estimated from this session's open-eye distribution
 * using a conservative per-session margin. No absolute EAR value is hardcoded
 * as a threshold. The reopen threshold adds hysteresis but stays below the
 * measured open-eye mean, so ordinary open-eye variation can end a closure.
 * Nothing here is persisted. This is an experimental geometric measurement,
 * not a clinical or safety-grade assessment.
 */

export type CalibrationStep = 'idle' | 'collecting' | 'success' | 'failed' | 'cancelled';

export type CalibrationFailureReason =
  | 'tracking-not-active'
  | 'face-not-single'
  | 'stale-results'
  | 'unstable-tracking'
  | 'invalid-sample'
  | 'tracking-gap'
  | 'page-hidden'
  | 'resolution-changed'
  | 'insufficient-samples'
  | 'insufficient-separation'
  | 'cancelled'
  | 'tracking-stopped'
  | 'camera-changed'
  | 'face-selection-changed';

export interface CalibrationResolution {
  width: number;
  height: number;
}

export interface CalibrationSample {
  leftEAR: number;
  rightEAR: number;
  atMs: number;
  /** Spatial-only track ID from the face tracker, when available. */
  faceId?: number | null;
}

export interface CalibrationSampleSummary {
  count: number;
  mean: number;
  min: number;
  max: number;
  /** 10th percentile; used to keep the estimated closure reference stable. */
  p10: number;
}

export interface CalibrationEyeResult {
  openMean: number;
  /** Estimated closure reference derived from the open-eye distribution. */
  closedMean: number;
  openSummary: CalibrationSampleSummary;
  /** Single-value summary for the derived closure reference. */
  closedSummary: CalibrationSampleSummary;
  /** Midpoint of openMean and the derived closure reference. */
  threshold: number;
  /** threshold + hysteresis, capped below the measured open-eye mean. */
  reopenThreshold: number;
  /** openMean - closedMean. */
  separation: number;
}

export interface CalibrationResult {
  left: CalibrationEyeResult;
  right: CalibrationEyeResult;
  capturedAtMs: number;
  resolution: CalibrationResolution;
  faceId: number | null;
}

export interface CalibrationFailure {
  reason: CalibrationFailureReason;
  message: string;
}

export interface CalibrationState {
  step: CalibrationStep;
  instruction: string;
  /** 0..1 across the single sampling session. */
  progress: number;
  openSampleCount: number;
  /** Low-EAR frames skipped as normal blinks. */
  skippedBlinkSamples: number;
  /** Frames rejected because they belonged to a different spatial face ID. */
  rejectedFaceSamples: number;
  failure: CalibrationFailure | null;
  result: CalibrationResult | null;
}

export const CALIBRATION_DURATION_MS = 2200;
export const CALIBRATION_MAX_SAMPLE_GAP_MS = 400;
export const CALIBRATION_UNSTABLE_TIMEOUT_MS = 1500;
export const CALIBRATION_MIN_EAR = 0.03;
export const CALIBRATION_MAX_EAR = 0.6;
export const CALIBRATION_MIN_OPEN_SAMPLES = 12;
export const CALIBRATION_MIN_SAMPLES_PER_EYE = 10;
export const CALIBRATION_MIN_SEPARATION = 0.04;
/** Conservative drop from the relaxed open-eye baseline to closure. */
export const CALIBRATION_CLOSURE_DROP_EAR = 0.1;
export const CALIBRATION_HYSTERESIS_FRACTION = 0.1;
export const CALIBRATION_MIN_HYSTERESIS_EAR = 0.008;
export const CALIBRATION_INSTRUCTION =
  'Look at the camera and relax your mouth. You can blink normally.';
export const CALIBRATION_UNSTABLE_MESSAGE =
  'Move into better light and center your face in the frame.';

const FAILURE_MESSAGES: Record<CalibrationFailureReason, string> = {
  'tracking-not-active':
    'Calibration needs active tracking with a live camera. Start the camera and tracking first.',
  'face-not-single':
    'More than one face is visible. Select one person in the preview, then click Calibrate.',
  'stale-results': CALIBRATION_UNSTABLE_MESSAGE,
  'unstable-tracking': CALIBRATION_UNSTABLE_MESSAGE,
  'invalid-sample': CALIBRATION_UNSTABLE_MESSAGE,
  'tracking-gap': CALIBRATION_UNSTABLE_MESSAGE,
  'page-hidden':
    'The page was hidden during calibration. Return to the visible tab and click Calibrate again.',
  'resolution-changed':
    'The camera resolution changed during calibration. Calibration was discarded.',
  'insufficient-samples': CALIBRATION_UNSTABLE_MESSAGE,
  'insufficient-separation': CALIBRATION_UNSTABLE_MESSAGE,
  cancelled: 'Calibration was cancelled.',
  'tracking-stopped':
    'Tracking stopped during calibration. Start tracking and click Calibrate again.',
  'camera-changed': 'The camera changed, so calibration was discarded.',
  'face-selection-changed':
    'The selected face changed, so calibration was discarded. Click Calibrate for the new face.',
};

const COMPLETE_INSTRUCTION = 'Calibration complete.';

export function createInitialCalibrationState(): CalibrationState {
  return {
    step: 'idle',
    instruction: '',
    progress: 0,
    openSampleCount: 0,
    skippedBlinkSamples: 0,
    rejectedFaceSamples: 0,
    failure: null,
    result: null,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (index - lower);
}

function summarize(values: readonly number[]): CalibrationSampleSummary {
  return {
    count: values.length,
    mean: mean(values),
    min: Math.min(...values),
    max: Math.max(...values),
    p10: percentile(values, 0.1),
  };
}

function sameResolution(
  a: CalibrationResolution | null,
  b: CalibrationResolution,
): boolean {
  return a !== null && a.width === b.width && a.height === b.height;
}

function eyeResult(values: readonly number[]): CalibrationEyeResult | null {
  if (values.length < CALIBRATION_MIN_SAMPLES_PER_EYE) return null;
  const openSummary = summarize(values);
  const closedMean = Math.max(
    CALIBRATION_MIN_EAR,
    openSummary.p10 - CALIBRATION_CLOSURE_DROP_EAR,
  );
  const separation = openSummary.mean - closedMean;
  if (!Number.isFinite(separation) || separation < CALIBRATION_MIN_SEPARATION) {
    return null;
  }
  const threshold = (openSummary.mean + closedMean) / 2;
  const hysteresis = Math.max(
    CALIBRATION_MIN_HYSTERESIS_EAR,
    separation * CALIBRATION_HYSTERESIS_FRACTION,
  );
  const reopenThreshold = Math.min(
    threshold + hysteresis,
    openSummary.mean - CALIBRATION_MIN_HYSTERESIS_EAR / 2,
  );
  if (!(reopenThreshold > threshold)) return null;
  return {
    openMean: openSummary.mean,
    closedMean,
    openSummary,
    closedSummary: {
      count: 1,
      mean: closedMean,
      min: closedMean,
      max: closedMean,
      p10: closedMean,
    },
    threshold,
    reopenThreshold,
    separation,
  };
}

export class CalibrationEngine {
  private state: CalibrationState = createInitialCalibrationState();
  private collecting = false;
  private startedAt: number | null = null;
  private lastSampleAt: number | null = null;
  private unstableSince: number | null = null;
  private resolution: CalibrationResolution | null = null;
  private faceId: number | null = null;
  private samples: CalibrationSample[] = [];

  getState(): CalibrationState {
    return {...this.state};
  }

  /** Starts a fresh single-session eye baseline. */
  begin(
    atMs: number,
    resolution: CalibrationResolution,
    faceId: number | null = null,
  ): void {
    this.reset();
    this.collecting = true;
    this.startedAt = atMs;
    this.lastSampleAt = atMs;
    this.resolution = {...resolution};
    this.faceId = faceId;
    this.publish(0);
  }

  /** Reuses a completed eye result while only the mouth baseline is retried. */
  resume(
    atMs: number,
    resolution: CalibrationResolution,
    faceId: number | null = null,
  ): void {
    if (!this.state.result) {
      this.begin(atMs, resolution, faceId);
      return;
    }
    this.collecting = false;
    this.startedAt = null;
    this.lastSampleAt = atMs;
    this.unstableSince = null;
    this.resolution = {...resolution};
    this.faceId = faceId;
    this.state = {
      ...this.state,
      step: 'success',
      instruction: COMPLETE_INSTRUCTION,
      progress: 1,
      failure: null,
    };
  }

  cancel(): void {
    if (!this.collecting) return;
    this.reset();
    this.state = {
      ...createInitialCalibrationState(),
      step: 'cancelled',
      failure: {reason: 'cancelled', message: FAILURE_MESSAGES.cancelled},
    };
  }

  retry(
    atMs: number,
    resolution: CalibrationResolution,
    faceId: number | null = null,
  ): void {
    this.begin(atMs, resolution, faceId);
  }

  observe(sample: CalibrationSample, resolution: CalibrationResolution): void {
    if (!this.collecting || this.startedAt === null) return;

    if (
      this.faceId !== null &&
      sample.faceId != null &&
      sample.faceId !== this.faceId
    ) {
      this.state = {
        ...this.state,
        rejectedFaceSamples: this.state.rejectedFaceSamples + 1,
      };
      return;
    }
    if (!sameResolution(this.resolution, resolution)) {
      this.fail('resolution-changed');
      return;
    }
    if (
      !Number.isFinite(sample.atMs) ||
      !Number.isFinite(sample.leftEAR) ||
      !Number.isFinite(sample.rightEAR) ||
      sample.leftEAR < CALIBRATION_MIN_EAR ||
      sample.leftEAR > CALIBRATION_MAX_EAR ||
      sample.rightEAR < CALIBRATION_MIN_EAR ||
      sample.rightEAR > CALIBRATION_MAX_EAR
    ) {
      this.pause(sample.atMs, 'invalid-sample');
      return;
    }
    if (
      this.lastSampleAt !== null &&
      sample.atMs - this.lastSampleAt > CALIBRATION_MAX_SAMPLE_GAP_MS
    ) {
      this.pause(sample.atMs, 'tracking-gap');
      return;
    }

    this.lastSampleAt = sample.atMs;
    this.unstableSince = null;
    if (this.isBlink(sample)) {
      this.state = {
        ...this.state,
        skippedBlinkSamples: this.state.skippedBlinkSamples + 1,
      };
      this.publish(this.progressAt(sample.atMs));
      return;
    }

    this.samples.push(sample);
    this.publish(this.progressAt(sample.atMs));
    this.finishIfReady(sample.atMs, resolution);
  }

  /**
   * A brief tracking gap only pauses the session. Valid samples already
   * collected from the same face remain in the window.
   */
  onInterruption(reason: CalibrationFailureReason, atMs?: number): void {
    if (!this.collecting) return;
    this.pause(atMs ?? this.lastSampleAt ?? this.startedAt ?? 0, reason);
  }

  invalidate(reason: 'camera-changed' | 'resolution-changed' | 'face-selection-changed'): void {
    this.fail(reason);
  }

  invalidateForFaceChange(): void {
    this.invalidate('face-selection-changed');
  }

  /** Records a precondition failure reported before the flow could begin. */
  failFor(reason: CalibrationFailureReason): void {
    this.fail(reason);
  }

  private isBlink(sample: CalibrationSample): boolean {
    if (this.samples.length < 5) return false;
    const leftMedian = median(this.samples.map((item) => item.leftEAR));
    const rightMedian = median(this.samples.map((item) => item.rightEAR));
    return (
      sample.leftEAR < leftMedian - CALIBRATION_MIN_SEPARATION ||
      sample.rightEAR < rightMedian - CALIBRATION_MIN_SEPARATION
    );
  }

  private progressAt(atMs: number): number {
    if (this.startedAt === null) return 0;
    const elapsed = Math.max(0, atMs - this.startedAt);
    const timeProgress = Math.min(1, elapsed / CALIBRATION_DURATION_MS);
    const sampleProgress = Math.min(
      1,
      this.samples.length / CALIBRATION_MIN_OPEN_SAMPLES,
    );
    return Math.min(1, timeProgress * 0.7 + sampleProgress * 0.3);
  }

  private finishIfReady(atMs: number, resolution: CalibrationResolution): void {
    if (this.startedAt === null) return;
    if (atMs - this.startedAt < CALIBRATION_DURATION_MS) return;
    if (this.samples.length < CALIBRATION_MIN_OPEN_SAMPLES) {
      this.fail('unstable-tracking');
      return;
    }

    const filtered = this.samples.filter((sample) => {
      const keep =
        sample.leftEAR >= CALIBRATION_MIN_EAR + CALIBRATION_MIN_SEPARATION / 2 &&
        sample.rightEAR >= CALIBRATION_MIN_EAR + CALIBRATION_MIN_SEPARATION / 2;
      if (!keep) {
        this.state = {
          ...this.state,
          skippedBlinkSamples: this.state.skippedBlinkSamples + 1,
        };
      }
      return keep;
    });
    const left = eyeResult(filtered.map((sample) => sample.leftEAR));
    const right = eyeResult(filtered.map((sample) => sample.rightEAR));
    if (!left || !right) {
      this.fail('unstable-tracking');
      return;
    }

    this.collecting = false;
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.state = {
      ...this.state,
      step: 'success',
      instruction: COMPLETE_INSTRUCTION,
      progress: 1,
      failure: null,
      result: {
        left,
        right,
        capturedAtMs: atMs,
        resolution: {...resolution},
        faceId: this.faceId,
      },
    };
  }

  private pause(atMs: number, reason: CalibrationFailureReason): void {
    if (!this.collecting) return;
    const eventMs = Number.isFinite(atMs)
      ? atMs
      : this.lastSampleAt ?? this.startedAt ?? 0;
    if (this.unstableSince === null) this.unstableSince = eventMs;
    if (eventMs - this.unstableSince >= CALIBRATION_UNSTABLE_TIMEOUT_MS) {
      this.fail(
        reason === 'invalid-sample' || reason === 'tracking-gap'
          ? 'unstable-tracking'
          : reason,
      );
      return;
    }
    // Advance the clock so the next valid frame after a short gap is sampled.
    this.lastSampleAt = eventMs;
    this.publish(this.progressAt(Math.max(0, this.lastSampleAt)));
  }

  private fail(reason: CalibrationFailureReason): void {
    this.collecting = false;
    this.samples = [];
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.resolution = null;
    this.faceId = null;
    this.state = {
      ...createInitialCalibrationState(),
      step: 'failed',
      failure: {reason, message: FAILURE_MESSAGES[reason]},
    };
  }

  private publish(progress: number): void {
    this.state = {
      ...this.state,
      step: this.collecting ? 'collecting' : this.state.step,
      instruction: this.collecting ? CALIBRATION_INSTRUCTION : this.state.instruction,
      progress,
      openSampleCount: this.samples.length,
      failure: null,
      result: this.collecting ? null : this.state.result,
    };
  }

  private reset(): void {
    this.collecting = false;
    this.samples = [];
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.resolution = null;
    this.faceId = null;
    this.state = createInitialCalibrationState();
  }
}

export function calibrationLabel(state: CalibrationState): string {
  switch (state.step) {
    case 'collecting':
      return 'Calibrating';
    case 'success':
      return 'Calibrated';
    case 'failed':
      return 'Calibration failed';
    case 'cancelled':
      return 'Calibration cancelled';
    default:
      return 'Not calibrated';
  }
}
