/**
 * Guided, in-memory eye calibration.
 *
 * This module is intentionally pure: the caller supplies monotonic timestamps
 * and EAR values, so the whole flow can be tested without a camera.
 *
 * Method and limitations
 * ----------------------
 * For each eye independently we collect a baseline while the user sits naturally
 * with eyes open, then a short deliberate bilateral closure. A short preparation
 * interval separates the instruction from sample collection, and closed-stage
 * samples that have not clearly dropped below the open baseline are rejected as
 * transition frames.
 *
 * The close threshold is the midpoint between the two measured means. The reopen
 * threshold adds hysteresis but is capped at the 10th percentile of the open
 * samples, so normal measured open variation can end a closure state. Both
 * thresholds are derived only from this session's samples; no reported EAR value
 * is hardcoded.
 *
 * Calibration fails if measurements are invalid, results are stale or interrupted,
 * the camera resolution changes mid-flow, too few stable samples are collected,
 * or the open/closed sample sets overlap. EAR is a geometric ratio from MediaPipe
 * landmarks. Thresholds depend on camera position, resolution, lighting, and
 * individual anatomy, and are valid only for the camera/resolution used during
 * calibration. This is an experimental measurement, not a clinical or
 * safety-grade assessment. Nothing here is persisted.
 */

export type CalibrationStep =
  | 'idle'
  | 'open'
  | 'preparing'
  | 'closed'
  | 'success'
  | 'failed'
  | 'cancelled';

export type CalibrationFailureReason =
  | 'tracking-not-active'
  | 'face-not-single'
  | 'stale-results'
  | 'invalid-sample'
  | 'tracking-gap'
  | 'page-hidden'
  | 'resolution-changed'
  | 'insufficient-samples'
  | 'insufficient-separation'
  | 'cancelled'
  | 'tracking-stopped'
  | 'camera-changed';

export interface CalibrationResolution {
  width: number;
  height: number;
}

export interface CalibrationSample {
  leftEAR: number;
  rightEAR: number;
  atMs: number;
}

export interface CalibrationSampleSummary {
  count: number;
  mean: number;
  min: number;
  max: number;
  /** 10th percentile; used to keep the reopen threshold within open variation. */
  p10: number;
}

export interface CalibrationEyeResult {
  openMean: number;
  closedMean: number;
  openSummary: CalibrationSampleSummary;
  closedSummary: CalibrationSampleSummary;
  /** Midpoint of openMean and closedMean. */
  threshold: number;
  /** threshold + hysteresis, capped at the low end of measured open values. */
  reopenThreshold: number;
  /** openMean - closedMean. */
  separation: number;
}

export interface CalibrationResult {
  left: CalibrationEyeResult;
  right: CalibrationEyeResult;
  capturedAtMs: number;
  resolution: CalibrationResolution;
}

export interface CalibrationFailure {
  reason: CalibrationFailureReason;
  message: string;
}

export interface CalibrationState {
  step: CalibrationStep;
  instruction: string;
  /** 0..1 across the whole guided flow. */
  progress: number;
  openProgress: number;
  prepareProgress: number;
  closedProgress: number;
  openSampleCount: number;
  closedSampleCount: number;
  /** Closed-stage samples rejected because they looked like transitions. */
  rejectedClosedSamples: number;
  failure: CalibrationFailure | null;
  result: CalibrationResult | null;
}

export const CALIBRATION_OPEN_DURATION_MS = 2500;
export const CALIBRATION_PREPARE_DURATION_MS = 600;
export const CALIBRATION_CLOSED_DURATION_MS = 700;
export const CALIBRATION_MAX_SAMPLE_GAP_MS = 400;
export const CALIBRATION_MIN_EAR = 0.03;
export const CALIBRATION_MAX_EAR = 0.6;
export const CALIBRATION_MIN_OPEN_SAMPLES = 10;
export const CALIBRATION_MIN_CLOSED_SAMPLES = 3;
export const CALIBRATION_MIN_SEPARATION = 0.04;
/** Hysteresis is relative to measured separation, not to a fixed EAR value. */
export const CALIBRATION_HYSTERESIS_FRACTION = 0.1;
export const CALIBRATION_MIN_HYSTERESIS_EAR = 0.008;

const FAILURE_MESSAGES: Record<CalibrationFailureReason, string> = {
  'tracking-not-active':
    'Calibration needs active tracking with a live camera. Start the camera and tracking first.',
  'face-not-single':
    'Calibration needs exactly one visible face. Center your face and try again.',
  'stale-results':
    'Calibration needs fresh tracking results. Check the camera preview and try again.',
  'invalid-sample':
    'Calibration received an invalid eye measurement. Check lighting and camera position, then retry.',
  'tracking-gap':
    'Calibration was interrupted by a gap in valid results. Keep one face visible and retry.',
  'page-hidden':
    'The page was hidden during calibration. Return to the visible tab and retry.',
  'resolution-changed':
    'The camera resolution changed during calibration. Calibration was discarded.',
  'insufficient-samples':
    'Not enough stable measurements were collected. Keep one face visible, close both eyes fully at the prompt, and retry.',
  'insufficient-separation':
    'Open and closed eye measurements overlapped or were too close to set a reliable threshold. Improve lighting or camera angle and retry.',
  cancelled: 'Calibration was cancelled.',
  'tracking-stopped':
    'Tracking stopped during calibration. Start tracking and retry.',
  'camera-changed': 'The camera changed, so calibration was discarded.',
};

const OPEN_INSTRUCTION =
  'Face the camera naturally at eye level and keep both eyes open.';
const PREPARE_INSTRUCTION =
  'Good. Keep your face still and get ready to close both eyes.';
const CLOSED_INSTRUCTION =
  'Now close both eyes completely and hold still until the progress bar fills.';

export function createInitialCalibrationState(): CalibrationState {
  return {
    step: 'idle',
    instruction: '',
    progress: 0,
    openProgress: 0,
    prepareProgress: 0,
    closedProgress: 0,
    openSampleCount: 0,
    closedSampleCount: 0,
    rejectedClosedSamples: 0,
    failure: null,
    result: null,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function eyeResult(
  open: readonly number[],
  closed: readonly number[],
): CalibrationEyeResult | null {
  if (open.length === 0 || closed.length === 0) return null;
  const openSummary = summarize(open);
  const closedSummary = summarize(closed);
  const separation = openSummary.mean - closedSummary.mean;
  if (!Number.isFinite(separation) || separation < CALIBRATION_MIN_SEPARATION) {
    return null;
  }
  const threshold = (openSummary.mean + closedSummary.mean) / 2;
  // A sample-level filter rejects obvious transitions; this final check rejects
  // sample sets whose ranges still straddle the derived threshold.
  const margin = Math.min(CALIBRATION_MIN_SEPARATION, separation * 0.25);
  if (
    closedSummary.max > threshold - margin ||
    openSummary.p10 < threshold + margin
  ) {
    return null;
  }
  const hysteresis = Math.max(
    CALIBRATION_MIN_HYSTERESIS_EAR,
    separation * CALIBRATION_HYSTERESIS_FRACTION,
  );
  const reopenThreshold = Math.min(
    threshold + hysteresis,
    openSummary.p10,
  );
  if (!(reopenThreshold > threshold)) return null;
  return {
    openMean: openSummary.mean,
    closedMean: closedSummary.mean,
    openSummary,
    closedSummary,
    threshold,
    reopenThreshold,
    separation,
  };
}

export class CalibrationEngine {
  private state: CalibrationState = createInitialCalibrationState();
  private step: 'idle' | 'open' | 'preparing' | 'closed' | 'cancelled' =
    'idle';
  private openSamples: CalibrationSample[] = [];
  private closedSamples: CalibrationSample[] = [];
  private rejectedClosedSamples = 0;
  private stageStartedAt: number | null = null;
  private lastSampleAt: number | null = null;
  private stageResolution: CalibrationResolution | null = null;
  private openSummary: {
    left: CalibrationSampleSummary;
    right: CalibrationSampleSummary;
  } | null = null;

  getState(): CalibrationState {
    return this.state;
  }

  /** Starts a fresh two-stage calibration with a preparation interval. */
  begin(atMs: number, resolution: CalibrationResolution): void {
    this.reset();
    this.step = 'open';
    this.stageStartedAt = atMs;
    this.lastSampleAt = atMs;
    this.stageResolution = {...resolution};
    this.publish(OPEN_INSTRUCTION, 0, 0, 0, 0);
  }

  cancel(): void {
    if (!this.isCollecting()) return;
    this.reset();
    this.step = 'cancelled';
    this.state = {
      ...createInitialCalibrationState(),
      step: 'cancelled',
      failure: {
        reason: 'cancelled',
        message: FAILURE_MESSAGES.cancelled,
      },
    };
  }

  /** Full restart after a failure; never reuses partial measurements. */
  retry(atMs: number, resolution: CalibrationResolution): void {
    this.begin(atMs, resolution);
  }

  observe(sample: CalibrationSample, resolution: CalibrationResolution): void {
    if (!this.isCollecting()) return;

    if (
      !Number.isFinite(sample.leftEAR) ||
      !Number.isFinite(sample.rightEAR) ||
      sample.leftEAR < CALIBRATION_MIN_EAR ||
      sample.leftEAR > CALIBRATION_MAX_EAR ||
      sample.rightEAR < CALIBRATION_MIN_EAR ||
      sample.rightEAR > CALIBRATION_MAX_EAR ||
      !Number.isFinite(sample.atMs)
    ) {
      this.fail('invalid-sample');
      return;
    }

    if (
      this.lastSampleAt !== null &&
      sample.atMs - this.lastSampleAt > CALIBRATION_MAX_SAMPLE_GAP_MS
    ) {
      this.fail('tracking-gap');
      return;
    }
    if (!sameResolution(this.stageResolution, resolution)) {
      this.fail('resolution-changed');
      return;
    }

    this.lastSampleAt = sample.atMs;

    if (this.step === 'open') {
      this.openSamples.push(sample);
      const elapsed = sample.atMs - (this.stageStartedAt ?? sample.atMs);
      this.publish(
        OPEN_INSTRUCTION,
        0.5 * this.progressFor(elapsed, CALIBRATION_OPEN_DURATION_MS),
        this.progressFor(elapsed, CALIBRATION_OPEN_DURATION_MS),
        0,
        0,
      );
      if (elapsed >= CALIBRATION_OPEN_DURATION_MS) {
        if (this.openSamples.length < CALIBRATION_MIN_OPEN_SAMPLES) {
          this.fail('insufficient-samples');
          return;
        }
        this.openSummary = {
          left: summarize(this.openSamples.map((item) => item.leftEAR)),
          right: summarize(this.openSamples.map((item) => item.rightEAR)),
        };
        this.step = 'preparing';
        this.stageStartedAt = sample.atMs;
        this.publish(PREPARE_INSTRUCTION, 0.5, 1, 0, 0);
      }
      return;
    }

    if (this.step === 'preparing') {
      // No samples are collected while the user reacts to the close prompt.
      const elapsed = sample.atMs - (this.stageStartedAt ?? sample.atMs);
      const prepareProgress = this.progressFor(
        elapsed,
        CALIBRATION_PREPARE_DURATION_MS,
      );
      this.publish(
        PREPARE_INSTRUCTION,
        0.5 + 0.1 * prepareProgress,
        1,
        prepareProgress,
        0,
      );
      if (elapsed >= CALIBRATION_PREPARE_DURATION_MS) {
        this.step = 'closed';
        this.stageStartedAt = sample.atMs;
        this.closedSamples = [];
        this.rejectedClosedSamples = 0;
        this.publish(CLOSED_INSTRUCTION, 0.6, 1, 1, 0);
      }
      return;
    }

    const baseline = this.openSummary;
    if (!baseline) {
      this.fail('invalid-sample');
      return;
    }
    // A closed-stage frame must be clearly below the low end of measured open
    // values for both eyes; otherwise it is a reaction/transition frame.
    const isClosed =
      sample.leftEAR < baseline.left.p10 - CALIBRATION_MIN_SEPARATION &&
      sample.rightEAR < baseline.right.p10 - CALIBRATION_MIN_SEPARATION;
    if (isClosed) this.closedSamples.push(sample);
    else this.rejectedClosedSamples += 1;

    const elapsed = sample.atMs - (this.stageStartedAt ?? sample.atMs);
    const closedProgress = this.progressFor(
      elapsed,
      CALIBRATION_CLOSED_DURATION_MS,
    );
    this.publish(
      CLOSED_INSTRUCTION,
      0.6 + 0.4 * closedProgress,
      1,
      1,
      closedProgress,
    );
    if (elapsed < CALIBRATION_CLOSED_DURATION_MS) return;

    if (this.closedSamples.length < CALIBRATION_MIN_CLOSED_SAMPLES) {
      this.fail('insufficient-samples');
      return;
    }
    const left = eyeResult(
      this.openSamples.map((item) => item.leftEAR),
      this.closedSamples.map((item) => item.leftEAR),
    );
    const right = eyeResult(
      this.openSamples.map((item) => item.rightEAR),
      this.closedSamples.map((item) => item.rightEAR),
    );
    if (!left || !right) {
      this.fail('insufficient-separation');
      return;
    }

    this.step = 'idle';
    this.state = {
      ...createInitialCalibrationState(),
      step: 'success',
      instruction:
        'Calibration complete. Start monitoring to measure bilateral eye closure.',
      progress: 1,
      openProgress: 1,
      prepareProgress: 1,
      closedProgress: 1,
      openSampleCount: this.openSamples.length,
      closedSampleCount: this.closedSamples.length,
      rejectedClosedSamples: this.rejectedClosedSamples,
      result: {
        left,
        right,
        capturedAtMs: sample.atMs,
        resolution: {...resolution},
      },
    };
  }

  /** A tracking interruption invalidates an in-progress calibration. */
  onInterruption(reason: CalibrationFailureReason): void {
    if (this.isCollecting()) {
      this.fail(reason);
      return;
    }
    if (
      this.state.result &&
      (reason === 'camera-changed' || reason === 'resolution-changed')
    ) {
      this.state = {
        ...createInitialCalibrationState(),
        step: 'failed',
        failure: {reason, message: FAILURE_MESSAGES[reason]},
      };
    }
  }

  /** External invalidation after the camera or its resolution changed. */
  invalidate(reason: 'camera-changed' | 'resolution-changed'): void {
    this.onInterruption(reason);
  }

  /** Records a precondition failure reported before the flow could begin. */
  failFor(reason: CalibrationFailureReason): void {
    this.fail(reason);
  }

  private isCollecting(): boolean {
    return this.step === 'open' || this.step === 'preparing' || this.step === 'closed';
  }

  private progressFor(elapsed: number, duration: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return Math.min(1, elapsed / duration);
  }

  private fail(reason: CalibrationFailureReason): void {
    this.step = 'idle';
    this.openSamples = [];
    this.closedSamples = [];
    this.rejectedClosedSamples = 0;
    this.openSummary = null;
    this.stageStartedAt = null;
    this.lastSampleAt = null;
    this.stageResolution = null;
    this.state = {
      ...createInitialCalibrationState(),
      step: 'failed',
      failure: {reason, message: FAILURE_MESSAGES[reason]},
    };
  }

  private publish(
    instruction: string,
    progress: number,
    openProgress: number,
    prepareProgress: number,
    closedProgress: number,
  ): void {
    this.state = {
      ...this.state,
      step: this.step,
      instruction,
      progress,
      openProgress,
      prepareProgress,
      closedProgress,
      openSampleCount: this.openSamples.length,
      closedSampleCount: this.closedSamples.length,
      rejectedClosedSamples: this.rejectedClosedSamples,
      failure: null,
      result: null,
    };
  }

  private reset(): void {
    this.step = 'idle';
    this.openSamples = [];
    this.closedSamples = [];
    this.rejectedClosedSamples = 0;
    this.stageStartedAt = null;
    this.lastSampleAt = null;
    this.stageResolution = null;
    this.openSummary = null;
    this.state = createInitialCalibrationState();
  }
}

export function calibrationLabel(state: CalibrationState): string {
  switch (state.step) {
    case 'open':
      return 'Calibrating: eyes open';
    case 'preparing':
      return 'Calibrating: get ready';
    case 'closed':
      return 'Calibrating: close eyes';
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
