/**
 * Experimental bilateral eye-closure measurement.
 *
 * Pure state machine: the caller supplies calibrated thresholds and monotonic
 * timestamps. No frame counts are used for elapsed time, no frames are stored,
 * and nothing is persisted.
 *
 * Bilateral closure means both measured eyes are below their own calibrated
 * threshold. Hysteresis and a two-sample confirmation reduce flicker. Any
 * interruption (missing/multiple faces, stale frames, hidden tab, or an excessive
 * inference gap) resets the elapsed timer and shows why monitoring is
 * unavailable. A normal blink is a short closure that never reaches the
 * configured prolonged duration.
 *
 * This is a visual measurement only: it never labels the person safe, awake, or
 * drowsy, and it does not produce alerts or diagnoses.
 */

import type {StatusTone} from '../types/dashboard';
import {
  CALIBRATION_HYSTERESIS_FRACTION,
  CALIBRATION_MIN_HYSTERESIS_EAR,
  type CalibrationResult,
  type CalibrationResolution,
} from './calibration';

export type MonitoringStatus =
  | 'not-calibrated'
  | 'ready'
  | 'eyes-open'
  | 'eyes-closed'
  | 'prolonged-closure'
  | 'unavailable';

export type MonitoringInterruption =
  | 'face-not-visible'
  | 'multiple-faces'
  | 'stale-frames'
  | 'page-hidden'
  | 'inference-gap'
  | 'tracking-stopped'
  | 'camera-changed'
  | 'resolution-changed';

export interface ClosureSample {
  leftEAR: number;
  rightEAR: number;
  atMs: number;
}

export interface MonitoringState {
  status: MonitoringStatus;
  label: string;
  reason: MonitoringInterruption | null;
  reasonLabel: string | null;
  tone: StatusTone;
  active: boolean;
  /** Continuous bilateral closure in milliseconds. */
  closureMs: number;
  leftClosed: boolean;
  rightClosed: boolean;
}

export const DEFAULT_PROLONGED_CLOSURE_MS = 800;
export const MIN_PROLONGED_CLOSURE_MS = 200;
export const MAX_PROLONGED_CLOSURE_MS = 5000;
/** Milliseconds of continuous bilateral closure before the prolonged state. */
export const CLOSURE_MAX_SAMPLE_GAP_MS = 500;
/** Re-exported for callers that describe the calibrated hysteresis band. */
export const CLOSURE_HYSTERESIS_FRACTION = CALIBRATION_HYSTERESIS_FRACTION;
export const CLOSURE_MIN_HYSTERESIS_EAR = CALIBRATION_MIN_HYSTERESIS_EAR;
export const CLOSURE_CONFIRM_SAMPLES = 2;

const STATUS_LABELS: Record<MonitoringStatus, string> = {
  'not-calibrated': 'Not calibrated',
  ready: 'Ready',
  'eyes-open': 'Monitoring: eyes open',
  'eyes-closed': 'Eyes closed',
  'prolonged-closure': 'Prolonged eye closure',
  unavailable: 'Monitoring unavailable',
};

const REASON_LABELS: Record<MonitoringInterruption, string> = {
  'face-not-visible': 'Face not visible',
  'multiple-faces': 'Multiple faces',
  'stale-frames': 'Stale frames',
  'page-hidden': 'Page hidden',
  'inference-gap': 'Inference gap',
  'tracking-stopped': 'Tracking stopped',
  'camera-changed': 'Camera changed',
  'resolution-changed': 'Camera resolution changed',
};

export function createInitialMonitoringState(): MonitoringState {
  return idleState(false);
}

export type SettingsValidation =
  | {ok: true; value: number}
  | {ok: false; message: string};

/** Settings unit is milliseconds of continuous bilateral closure. */
export function validateProlongedClosureMs(value: unknown): SettingsValidation {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {ok: false, message: 'Enter a number of milliseconds.'};
  }
  if (!Number.isInteger(value)) {
    return {ok: false, message: 'Use a whole number of milliseconds.'};
  }
  if (value < MIN_PROLONGED_CLOSURE_MS || value > MAX_PROLONGED_CLOSURE_MS) {
    return {
      ok: false,
      message: `Use ${MIN_PROLONGED_CLOSURE_MS}–${MAX_PROLONGED_CLOSURE_MS} ms.`,
    };
  }
  return {ok: true, value};
}

type Eye = 'left' | 'right';
type ClosedFlags = Record<Eye, boolean>;

function stateFor(
  status: MonitoringStatus,
  options: {
    active: boolean;
    reason?: MonitoringInterruption | null;
    closureMs?: number;
    closed?: ClosedFlags;
    tone?: StatusTone;
  },
): MonitoringState {
  const tone: StatusTone =
    options.tone ??
    (status === 'prolonged-closure' || status === 'unavailable'
      ? 'red'
      : status === 'eyes-closed'
        ? 'amber'
        : 'teal');
  return {
    status,
    label: STATUS_LABELS[status],
    reason: options.reason ?? null,
    reasonLabel: options.reason ? REASON_LABELS[options.reason] : null,
    tone,
    active: options.active,
    closureMs: options.closureMs ?? 0,
    leftClosed: options.closed?.left ?? false,
    rightClosed: options.closed?.right ?? false,
  };
}

function idleState(calibrated: boolean): MonitoringState {
  return stateFor(calibrated ? 'ready' : 'not-calibrated', {
    active: false,
    tone: calibrated ? 'teal' : 'neutral',
  });
}

export class EyeClosureMonitor {
  private calibration: CalibrationResult | null = null;
  private resolution: CalibrationResolution | null = null;
  private prolongedClosureMs = DEFAULT_PROLONGED_CLOSURE_MS;
  private state: MonitoringState = idleState(false);

  private closed: ClosedFlags = {left: false, right: false};
  private pending: Record<Eye, number> = {left: 0, right: 0};
  private closureStartedAt: number | null = null;
  private lastSampleAt: number | null = null;

  getState(): MonitoringState {
    return this.state;
  }

  getProlongedClosureMs(): number {
    return this.prolongedClosureMs;
  }

  setProlongedClosureMs(value: number): void {
    const validated = validateProlongedClosureMs(value);
    if (!validated.ok) return;
    this.prolongedClosureMs = validated.value;
    if (this.state.status === 'prolonged-closure' && this.state.active) {
      this.state = {
        ...this.state,
        status:
          this.state.closureMs >= this.prolongedClosureMs
            ? 'prolonged-closure'
            : 'eyes-closed',
        label:
          this.state.closureMs >= this.prolongedClosureMs
            ? STATUS_LABELS['prolonged-closure']
            : STATUS_LABELS['eyes-closed'],
        tone:
          this.state.closureMs >= this.prolongedClosureMs ? 'red' : 'amber',
      };
    }
  }

  setCalibration(result: CalibrationResult | null): void {
    this.calibration = result;
    this.resolution = result ? {...result.resolution} : null;
    this.stop();
  }

  setResolution(resolution: CalibrationResolution): void {
    if (!this.resolution) return;
    if (
      this.resolution.width !== resolution.width ||
      this.resolution.height !== resolution.height
    ) {
      this.interrupt('resolution-changed');
    }
  }

  /** Returns false when calibration is missing or the session cannot start. */
  start(atMs: number): boolean {
    if (!this.calibration || !Number.isFinite(atMs)) return false;
    this.resetClosure();
    this.lastSampleAt = atMs;
    this.state = {
      ...stateFor('eyes-open', {active: true}),
    };
    return true;
  }

  stop(): void {
    this.resetClosure();
    this.lastSampleAt = null;
    this.state = idleState(this.calibration !== null);
  }

  observe(sample: ClosureSample): void {
    if (!this.state.active || !this.calibration) return;
    // An interruption is a terminal state for the session: keep showing its
    // reason until the user explicitly stops and starts monitoring again.
    if (this.state.status === 'unavailable') return;
    if (!Number.isFinite(sample.atMs)) return;
    if (
      !Number.isFinite(sample.leftEAR) ||
      !Number.isFinite(sample.rightEAR)
    ) {
      this.interrupt('inference-gap');
      return;
    }

    if (
      this.lastSampleAt !== null &&
      sample.atMs - this.lastSampleAt > CLOSURE_MAX_SAMPLE_GAP_MS
    ) {
      this.interrupt('inference-gap');
      return;
    }
    this.lastSampleAt = sample.atMs;

    this.updateEye('left', sample.leftEAR);
    this.updateEye('right', sample.rightEAR);

    const bilateral = this.closed.left && this.closed.right;
    if (!bilateral) {
      // Keep per-eye confirmation across frames so a two-sample transition is
      // possible; only the continuous closure timer is reset.
      this.closureStartedAt = null;
      this.state = stateFor('eyes-open', {
        active: true,
        closed: {...this.closed},
      });
      return;
    }

    if (this.closureStartedAt === null) this.closureStartedAt = sample.atMs;
    const closureMs = Math.max(0, sample.atMs - this.closureStartedAt);
    const prolonged = closureMs >= this.prolongedClosureMs;
    this.state = stateFor(prolonged ? 'prolonged-closure' : 'eyes-closed', {
      active: true,
      closureMs,
      closed: {...this.closed},
    });
  }

  /** Reports why an explicit Start monitoring action could not begin. */
  failStart(reason: MonitoringInterruption): void {
    this.resetClosure();
    this.lastSampleAt = null;
    this.state = stateFor('unavailable', {active: false, reason});
  }

  interrupt(reason: MonitoringInterruption): void {
    if (!this.state.active) return;
    if (this.state.status === 'unavailable' && this.state.reason === reason) {
      return;
    }
    this.resetClosure();
    this.lastSampleAt = null;
    this.state = stateFor('unavailable', {active: true, reason});
  }

  private updateEye(eye: Eye, ear: number): void {
    const calibrated = this.calibration?.[eye];
    if (!calibrated) return;
    const threshold = calibrated.threshold;
    // ReopenThreshold is derived during calibration from the same samples: a
    // hysteresis band that stays within normal measured open-eye variation.
    const reopenThreshold =
      calibrated.reopenThreshold ??
      threshold +
        Math.max(
          CLOSURE_MIN_HYSTERESIS_EAR,
          calibrated.separation * CLOSURE_HYSTERESIS_FRACTION,
        );
    const currentlyClosed = this.closed[eye];
    // Enter below the close threshold, leave only above the reopen threshold.
    const closedNow = currentlyClosed ? ear <= reopenThreshold : ear <= threshold;

    if (closedNow === currentlyClosed) {
      this.pending[eye] = 0;
      return;
    }
    this.pending[eye] += 1;
    if (this.pending[eye] >= CLOSURE_CONFIRM_SAMPLES) {
      this.closed[eye] = closedNow;
      this.pending[eye] = 0;
    }
  }

  private resetClosure(): void {
    this.closed = {left: false, right: false};
    this.pending = {left: 0, right: 0};
    this.closureStartedAt = null;
  }
}
