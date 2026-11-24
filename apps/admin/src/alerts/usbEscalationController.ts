import type {CalibrationStep} from '../vision/calibration';
import type {
  FacePresence,
  StaleReason,
  TrackingPhase,
} from '../vision/faceTrackingController';
import type {MonitoringState} from '../vision/eyeClosureMonitor';
import type {HardwareAlertOutcome} from './esp32HardwareAlerts';
import {SERIAL_ESCALATION_RENEW_MS} from './usbSerialAlert';

/**
 * Release gate. The firmware still advertises and implements escalation, but
 * this build intentionally never starts it until the 5-second cadence has been
 * physically accepted. Basic one-shot USB/Wi-Fi alerts are unaffected.
 */
export const USB_ESCALATION_RELEASE_ENABLED = false;

/** Continuous bilateral closure required before escalation starts. */
export const ESCALATION_AFTER_MS = 5000;

export type EscalationCommand = 'START' | 'RENEW' | 'STOP';

export interface UsbEscalationSnapshot {
  usbConnected: boolean;
  escalationSupported: boolean;
  hardwareAlertsEnabled: boolean;
  hardwareTransport: 'wifi' | 'usb';
  cameraLive: boolean;
  selectedCamera: string;
  cameraKey: string | null;
  monitoring: Pick<MonitoringState, 'status' | 'active' | 'reason' | 'closureMs'>;
  tracking: {
    phase: TrackingPhase;
    facePresence: FacePresence;
    staleReason: StaleReason | null;
    /** Same monotonic clock as monitoring samples (performance.now()). */
    lastInferenceCompletedAtMs: number | null;
    calibrationStep: CalibrationStep;
  };
}

export interface UsbEscalationStatus {
  active: boolean;
  message: string | null;
}

export interface UsbEscalationOptions {
  send: (command: EscalationCommand) => Promise<HardwareAlertOutcome>;
  now?: () => number;
  renewMs?: number;
  /** A missing inference beyond this window is never treated as closed eyes. */
  freshnessMs?: number;
  onStatus?: (status: UsbEscalationStatus) => void;
}

function isCalibrationActive(step: CalibrationStep): boolean {
  return step === 'collecting';
}

/**
 * Fresh closure evidence only. This is separate from transport gating so a
 * disconnected/reconnected device cannot replay an old interval: after any stop
 * the controller stays latched until this function becomes false (the eyes
 * reopened or the closure evidence ended).
 */
export function hasFreshEscalationClosure(
  snapshot: UsbEscalationSnapshot,
  nowMs: number,
  freshnessMs: number,
): boolean {
  const {monitoring, tracking} = snapshot;
  const lastInference = tracking.lastInferenceCompletedAtMs;
  const ageMs =
    lastInference === null || !Number.isFinite(lastInference)
      ? Number.POSITIVE_INFINITY
      : nowMs - lastInference;

  return (
    snapshot.cameraLive &&
    snapshot.selectedCamera === 'this-device' &&
    snapshot.cameraKey !== null &&
    monitoring.active &&
    monitoring.status === 'prolonged-closure' &&
    monitoring.reason === null &&
    Number.isFinite(monitoring.closureMs) &&
    monitoring.closureMs >= ESCALATION_AFTER_MS &&
    tracking.phase === 'running' &&
    tracking.facePresence === 'single' &&
    tracking.staleReason === null &&
    !isCalibrationActive(tracking.calibrationStep) &&
    ageMs >= 0 &&
    ageMs <= freshnessMs
  );
}

/** Fresh closure plus a ready, verified, enabled USB escalation transport. */
export function isEscalationClosureValid(
  snapshot: UsbEscalationSnapshot,
  nowMs: number,
  freshnessMs: number,
): boolean {
  return (
    hasFreshEscalationClosure(snapshot, nowMs, freshnessMs) &&
    snapshot.usbConnected &&
    snapshot.escalationSupported &&
    snapshot.hardwareAlertsEnabled &&
    snapshot.hardwareTransport === 'usb'
  );
}

/**
 * Owns the browser side of one escalation session. It never queues commands:
 * each START/RENEW/STOP is sent once with a fresh ID by the transport. When a
 * snapshot becomes invalid it stops renewing and attempts one best-effort STOP;
 * the firmware lease is the final silent-on-timeout guarantee.
 */
export class UsbEscalationController {
  private readonly send: UsbEscalationOptions['send'];
  private readonly now: () => number;
  private readonly renewMs: number;
  private readonly freshnessMs: number;
  private readonly onStatus: (status: UsbEscalationStatus) => void;

  private snapshot: UsbEscalationSnapshot | null = null;
  private active = false;
  private renewing = false;
  private suppressed = false;
  private cameraKey: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: UsbEscalationStatus = {active: false, message: null};

  constructor(options: UsbEscalationOptions) {
    this.send = options.send;
    this.now = options.now ?? (() => performance.now());
    this.renewMs = options.renewMs ?? SERIAL_ESCALATION_RENEW_MS;
    this.freshnessMs = options.freshnessMs ?? 500;
    this.onStatus = options.onStatus ?? (() => {});
  }

  isActive(): boolean {
    return this.active;
  }

  update(snapshot: UsbEscalationSnapshot): void {
    this.snapshot = snapshot;
    if (this.active && this.cameraChanged(snapshot)) {
      this.stop('Escalation stopped: the camera changed.');
    }
    const freshClosure = hasFreshEscalationClosure(snapshot, this.now(), this.freshnessMs);
    if (!isEscalationClosureValid(snapshot, this.now(), this.freshnessMs)) {
      if (this.active) this.stop('Escalation stopped: closure evidence is no longer valid.');
      if (!freshClosure) this.suppressed = false;
      return;
    }
    if (!freshClosure) this.suppressed = false;
    // A stopped interval never restarts for the same physical closure.
    if (this.suppressed || this.active) return;
    this.activate();
  }

  /** Best-effort immediate stop. Safe to call repeatedly. */
  stop(message = 'Escalation stopped.'): void {
    const wasActive = this.active;
    this.clearTimer();
    this.active = false;
    this.renewing = false;
    if (wasActive) this.suppressed = true;
    this.cameraKey = null;
    this.publish({active: false, message: wasActive ? message : null});
    if (wasActive) void this.send('STOP').catch(() => {});
  }

  /** Silences browser-side timers without sending a new command. */
  reset(): void {
    this.clearTimer();
    this.active = false;
    this.renewing = false;
    this.suppressed = true;
    this.cameraKey = null;
    this.publish({active: false, message: null});
  }

  dispose(): void {
    this.reset();
  }

  private activate(): void {
    this.active = true;
    this.cameraKey = this.snapshot?.cameraKey ?? null;
    this.publish({
      active: true,
      message:
        '5-second continuous closure reached; the 2 kHz escalation pattern was requested.',
    });
    this.timer = setInterval(() => this.tick(), this.renewMs);
    void this.handleCommand('START');
  }

  private tick(): void {
    if (!this.active) return;
    const snapshot = this.snapshot;
    if (!snapshot || this.cameraChanged(snapshot)) {
      this.stop('Escalation stopped: closure evidence is no longer valid.');
      return;
    }
    if (!isEscalationClosureValid(snapshot, this.now(), this.freshnessMs)) {
      this.stop('Escalation stopped: closure evidence is no longer valid.');
      return;
    }
    if (this.renewing) return;
    this.renewing = true;
    void this.handleCommand('RENEW').finally(() => {
      this.renewing = false;
    });
  }

  private async handleCommand(command: 'START' | 'RENEW'): Promise<void> {
    const outcome = await this.send(command);
    if (!this.active) return;
    if (outcome.aborted) return;
    if (!outcome.ok) {
      this.stop(`Escalation ${command.toLowerCase()} was rejected; no retry queued.`);
    }
  }

  private cameraChanged(snapshot: UsbEscalationSnapshot): boolean {
    return this.cameraKey !== null && this.cameraKey !== snapshot.cameraKey;
  }

  private publish(status: UsbEscalationStatus): void {
    if (this.status.active === status.active && this.status.message === status.message) return;
    this.status = status;
    this.onStatus(status);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
