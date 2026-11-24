/**
 * Session-only relaxed-mouth baseline for the single calibration session.
 *
 * Mouth samples are collected at the same time as eye samples. Talking and
 * invalid landmarks are skipped without discarding already valid samples; a
 * brief tracking gap only pauses collection. An intentionally separate class
 * keeps the existing eye EAR calculation and closure thresholds untouched.
 */

import {
  CALIBRATION_DURATION_MS,
  CALIBRATION_INSTRUCTION,
  CALIBRATION_UNSTABLE_MESSAGE,
  CALIBRATION_UNSTABLE_TIMEOUT_MS,
} from './calibration';

export type MouthBaselineStep = 'idle' | 'collecting' | 'success' | 'failed';

export type MouthBaselineFailureReason =
  | 'tracking-gap'
  | 'invalid-sample'
  | 'unstable-mouth'
  | 'face-selection-changed'
  | 'camera-changed'
  | 'cancelled';

export interface MouthBaselineFailure {
  reason: MouthBaselineFailureReason;
  message: string;
}

export interface MouthBaselineState {
  step: MouthBaselineStep;
  instruction: string;
  progress: number;
  sampleCount: number;
  /** High opening frames skipped as talking. */
  skippedTalkingSamples: number;
  /** Frames rejected because they belonged to a different spatial face ID. */
  rejectedFaceSamples: number;
  relaxedOpening: number | null;
  failure: MouthBaselineFailure | null;
}

export interface MouthBaselineSample {
  atMs: number;
  opening: number | null;
  faceId?: number | null;
  valid?: boolean;
}

export const MOUTH_BASELINE_DURATION_MS = CALIBRATION_DURATION_MS;
export const MOUTH_BASELINE_MAX_SAMPLE_GAP_MS = 400;
export const MOUTH_BASELINE_MIN_SAMPLES = 12;
export const MOUTH_BASELINE_MAX_RELAXED_OPENING = 0.35;
export const MOUTH_BASELINE_MAX_SPREAD = 0.15;
export const MOUTH_BASELINE_TALKING_DELTA = 0.15;
export const MOUTH_BASELINE_UNSTABLE_TIMEOUT_MS = CALIBRATION_UNSTABLE_TIMEOUT_MS;

const FAILURE_MESSAGES: Record<MouthBaselineFailureReason, string> = {
  'tracking-gap': CALIBRATION_UNSTABLE_MESSAGE,
  'invalid-sample': CALIBRATION_UNSTABLE_MESSAGE,
  'unstable-mouth': CALIBRATION_UNSTABLE_MESSAGE,
  'face-selection-changed':
    'The selected face changed, so calibration was discarded. Click Calibrate for the new face.',
  'camera-changed': 'The camera changed, so calibration was discarded.',
  cancelled: 'Calibration was cancelled.',
};

export function createInitialMouthBaselineState(): MouthBaselineState {
  return {
    step: 'idle',
    instruction: '',
    progress: 0,
    sampleCount: 0,
    skippedTalkingSamples: 0,
    rejectedFaceSamples: 0,
    relaxedOpening: null,
    failure: null,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export class MouthBaselineEngine {
  private state = createInitialMouthBaselineState();
  private collecting = false;
  private startedAt: number | null = null;
  private lastSampleAt: number | null = null;
  private unstableSince: number | null = null;
  private faceId: number | null = null;
  private samples: number[] = [];

  getState(): MouthBaselineState {
    return {...this.state};
  }

  begin(atMs: number, faceId: number | null = null): void {
    this.reset();
    this.collecting = true;
    this.startedAt = atMs;
    this.lastSampleAt = atMs;
    this.faceId = faceId;
    this.publish(0);
  }

  /** Reuses a completed relaxed-mouth baseline when only eyes need retrying. */
  resume(atMs: number, faceId: number | null = null): void {
    if (this.state.relaxedOpening === null) {
      this.begin(atMs, faceId);
      return;
    }
    this.collecting = false;
    this.startedAt = null;
    this.lastSampleAt = atMs;
    this.unstableSince = null;
    this.faceId = faceId;
    this.state = {
      ...this.state,
      step: 'success',
      instruction: 'Calibration complete.',
      progress: 1,
      failure: null,
    };
  }

  cancel(): void {
    if (!this.collecting) return;
    this.fail('cancelled');
  }

  /** Retries just this baseline while the caller keeps any eye result intact. */
  retry(atMs: number, faceId: number | null = null): void {
    this.begin(atMs, faceId);
  }

  reset(): void {
    this.collecting = false;
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.faceId = null;
    this.samples = [];
    this.state = createInitialMouthBaselineState();
  }

  observe(sample: MouthBaselineSample): void {
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
    if (
      sample.valid === false ||
      !Number.isFinite(sample.atMs) ||
      sample.opening === null ||
      !Number.isFinite(sample.opening) ||
      sample.opening < 0
    ) {
      this.pause(sample.atMs, 'invalid-sample');
      return;
    }
    if (
      this.lastSampleAt !== null &&
      sample.atMs >= this.lastSampleAt &&
      sample.atMs - this.lastSampleAt > MOUTH_BASELINE_MAX_SAMPLE_GAP_MS
    ) {
      this.pause(sample.atMs, 'tracking-gap');
      return;
    }

    this.lastSampleAt = sample.atMs;
    this.unstableSince = null;
    if (this.isTalking(sample.opening)) {
      this.state = {
        ...this.state,
        skippedTalkingSamples: this.state.skippedTalkingSamples + 1,
      };
      this.publish(this.progressAt(sample.atMs));
      return;
    }

    this.samples.push(sample.opening);
    this.publish(this.progressAt(sample.atMs));
    this.finishIfReady(sample.atMs);
  }

  /** A transient gap pauses collection without clearing valid samples. */
  onInterruption(reason: MouthBaselineFailureReason, atMs?: number): void {
    if (!this.collecting) return;
    this.pause(atMs ?? this.lastSampleAt ?? this.startedAt ?? 0, reason);
  }

  interrupt(reason: MouthBaselineFailureReason, atMs?: number): void {
    this.onInterruption(reason, atMs);
  }

  /** A face/camera change invalidates the whole baseline immediately. */
  invalidate(reason: MouthBaselineFailureReason): void {
    this.fail(reason);
  }

  private isTalking(opening: number): boolean {
    if (this.samples.length < 5) return false;
    return opening > median(this.samples) + MOUTH_BASELINE_TALKING_DELTA;
  }

  private progressAt(atMs: number): number {
    if (this.startedAt === null) return 0;
    const elapsed = Math.max(0, atMs - this.startedAt);
    const timeProgress = Math.min(1, elapsed / MOUTH_BASELINE_DURATION_MS);
    const sampleProgress = Math.min(
      1,
      this.samples.length / MOUTH_BASELINE_MIN_SAMPLES,
    );
    return Math.min(1, timeProgress * 0.7 + sampleProgress * 0.3);
  }

  private finishIfReady(atMs: number): void {
    if (this.startedAt === null) return;
    if (atMs - this.startedAt < MOUTH_BASELINE_DURATION_MS) return;
    if (this.samples.length < MOUTH_BASELINE_MIN_SAMPLES) {
      this.fail('unstable-mouth');
      return;
    }

    const baselineMedian = median(this.samples);
    const relaxed = this.samples.filter((value) => {
      const keep = value <= baselineMedian + MOUTH_BASELINE_TALKING_DELTA;
      if (!keep) {
        this.state = {
          ...this.state,
          skippedTalkingSamples: this.state.skippedTalkingSamples + 1,
        };
      }
      return keep;
    });
    if (relaxed.length < MOUTH_BASELINE_MIN_SAMPLES) {
      this.fail('unstable-mouth');
      return;
    }
    const value = median(relaxed);
    const spread = Math.max(...relaxed) - Math.min(...relaxed);
    if (
      value > MOUTH_BASELINE_MAX_RELAXED_OPENING ||
      spread > MOUTH_BASELINE_MAX_SPREAD
    ) {
      this.fail('unstable-mouth');
      return;
    }

    this.collecting = false;
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.state = {
      ...this.state,
      step: 'success',
      instruction: 'Calibration complete.',
      progress: 1,
      relaxedOpening: value,
      failure: null,
    };
  }

  private pause(atMs: number, reason: MouthBaselineFailureReason): void {
    if (!this.collecting) return;
    const eventMs = Number.isFinite(atMs)
      ? atMs
      : this.lastSampleAt ?? this.startedAt ?? 0;
    if (this.unstableSince === null) this.unstableSince = eventMs;
    if (eventMs - this.unstableSince >= MOUTH_BASELINE_UNSTABLE_TIMEOUT_MS) {
      this.fail(
        reason === 'invalid-sample' || reason === 'tracking-gap'
          ? 'unstable-mouth'
          : reason,
      );
      return;
    }
    // Advance the clock so the next valid frame after a short gap is sampled.
    this.lastSampleAt = eventMs;
    this.publish(this.progressAt(Math.max(0, this.lastSampleAt)));
  }

  private fail(reason: MouthBaselineFailureReason): void {
    this.collecting = false;
    this.samples = [];
    this.startedAt = null;
    this.lastSampleAt = null;
    this.unstableSince = null;
    this.faceId = null;
    this.state = {
      ...createInitialMouthBaselineState(),
      step: 'failed',
      progress: 0,
      instruction: FAILURE_MESSAGES[reason],
      relaxedOpening: null,
      failure: {reason, message: FAILURE_MESSAGES[reason]},
    };
  }

  private publish(progress: number): void {
    this.state = {
      ...this.state,
      step: this.collecting ? 'collecting' : this.state.step,
      instruction: this.collecting
        ? CALIBRATION_INSTRUCTION
        : this.state.instruction,
      progress,
      sampleCount: this.samples.length,
      failure: null,
      relaxedOpening: this.collecting ? null : this.state.relaxedOpening,
    };
  }
}
