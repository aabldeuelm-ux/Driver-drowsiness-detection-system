import {describe, expect, it} from 'vitest';
import type {CalibrationEyeResult, CalibrationResult} from '../calibration';
import {
  DEFAULT_PROLONGED_CLOSURE_MS,
  EyeClosureMonitor,
  validateProlongedClosureMs,
} from '../eyeClosureMonitor';

const RESOLUTION = {width: 640, height: 480};

function eye(overrides: Partial<CalibrationEyeResult> = {}): CalibrationEyeResult {
  const openMean = overrides.openMean ?? 0.25;
  const closedMean = overrides.closedMean ?? 0.05;
  const threshold = overrides.threshold ?? 0.15;
  const separation = overrides.separation ?? 0.2;
  const reopenThreshold = overrides.reopenThreshold ?? 0.22;
  return {
    openMean,
    closedMean,
    threshold,
    reopenThreshold,
    separation,
    openSummary: {
      count: 10,
      mean: openMean,
      min: openMean - 0.02,
      max: openMean + 0.02,
      p10: reopenThreshold,
    },
    closedSummary: {
      count: 5,
      mean: closedMean,
      min: closedMean - 0.01,
      max: closedMean + 0.01,
      p10: closedMean,
    },
    ...overrides,
  };
}

function calibration(overrides: Partial<CalibrationResult> = {}): CalibrationResult {
  return {
    left: eye(),
    right: eye(),
    faceId: null,
    capturedAtMs: 1000,
    resolution: RESOLUTION,
    ...overrides,
  };
}

function monitorWith(result: CalibrationResult | null = calibration()): EyeClosureMonitor {
  const monitor = new EyeClosureMonitor();
  monitor.setCalibration(result);
  return monitor;
}

function observePair(
  monitor: EyeClosureMonitor,
  atMs: number,
  leftEAR: number,
  rightEAR = leftEAR,
): void {
  monitor.observe({leftEAR, rightEAR, atMs});
}

describe('EyeClosureMonitor', () => {
  it('does not start without a calibration result', () => {
    const monitor = new EyeClosureMonitor();
    expect(monitor.start(0)).toBe(false);
    expect(monitor.getState().status).toBe('not-calibrated');
  });

  it('treats a normal blink as a short closure without prolonged state', () => {
    const monitor = monitorWith();
    monitor.setProlongedClosureMs(800);
    monitor.start(0);

    observePair(monitor, 100, 0.25);
    observePair(monitor, 200, 0.08);
    expect(monitor.getState().status).toBe('eyes-open');

    observePair(monitor, 300, 0.08);
    observePair(monitor, 400, 0.08);
    expect(monitor.getState().status).toBe('eyes-closed');
    expect(monitor.getState().closureMs).toBe(100);

    observePair(monitor, 500, 0.25);
    observePair(monitor, 600, 0.25);
    expect(monitor.getState().status).toBe('eyes-open');
    expect(monitor.getState().closureMs).toBe(0);
    expect(monitor.getState().leftClosed).toBe(false);
    expect(monitor.getState().rightClosed).toBe(false);
  });

  it('measures sustained bilateral closure with timestamps, not frame counts', () => {
    const monitor = monitorWith();
    monitor.start(0);

    observePair(monitor, 100, 0.08);
    observePair(monitor, 200, 0.08);
    observePair(monitor, 300, 0.08);
    observePair(monitor, 500, 0.08);
    expect(monitor.getState().status).toBe('eyes-closed');
    expect(monitor.getState().closureMs).toBe(300);

    // Irregular intervals still produce an 800 ms measurement.
    observePair(monitor, 1000, 0.08);
    expect(monitor.getState().status).toBe('prolonged-closure');
    expect(monitor.getState().closureMs).toBe(800);
    expect(monitor.getState().label).toBe('Prolonged eye closure');
  });

  it('uses the calibrated reopen threshold for hysteresis', () => {
    const monitor = monitorWith();
    monitor.start(0);

    observePair(monitor, 100, 0.08);
    observePair(monitor, 200, 0.08);
    observePair(monitor, 600, 0.08);
    observePair(monitor, 1000, 0.08);
    expect(monitor.getState().status).toBe('prolonged-closure');

    // Close threshold 0.15, calibrated reopen threshold 0.22.
    observePair(monitor, 1050, 0.19);
    expect(monitor.getState().status).toBe('prolonged-closure');
    expect(monitor.getState().leftClosed).toBe(true);

    // Exactly at the reopen threshold still counts as closed; above it reopens.
    observePair(monitor, 1100, 0.22);
    expect(monitor.getState().leftClosed).toBe(true);
    observePair(monitor, 1150, 0.23);
    observePair(monitor, 1200, 0.23);
    expect(monitor.getState().status).toBe('eyes-open');
    expect(monitor.getState().closureMs).toBe(0);
  });

  it('does not sustain closure when open-eye variation reaches the calibrated low range', () => {
    // The raw hysteresis band would be 0.15 + (0.9 * 0.1) = 0.24, but the
    // calibrated low open value is 0.22, so reopening must happen by 0.22.
    const monitor = monitorWith(
      calibration({
        left: eye({separation: 0.9, reopenThreshold: 0.22}),
        right: eye({separation: 0.9, reopenThreshold: 0.22}),
      }),
    );
    monitor.start(0);

    observePair(monitor, 100, 0.08);
    observePair(monitor, 200, 0.08);
    observePair(monitor, 500, 0.08);
    observePair(monitor, 900, 0.08);
    observePair(monitor, 1000, 0.08);
    expect(monitor.getState().status).toBe('prolonged-closure');

    // A dip into the measured open range ends the closure after confirmation.
    observePair(monitor, 1050, 0.22);
    observePair(monitor, 1100, 0.3);
    observePair(monitor, 1150, 0.3);
    observePair(monitor, 1200, 0.22);
    expect(monitor.getState().status).toBe('eyes-open');
    expect(monitor.getState().closureMs).toBe(0);
    expect(monitor.getState().leftClosed).toBe(false);
    expect(monitor.getState().rightClosed).toBe(false);
  });

  it('reopens a partly open eye once it clears the calibrated reopen threshold', () => {
    const partiallyOpenCalibration = calibration({
      left: eye({
        openMean: 0.4,
        closedMean: 0.18,
        threshold: 0.29,
        separation: 0.22,
        reopenThreshold: 0.312,
        openSummary: {
          count: 20,
          mean: 0.4,
          min: 0.36,
          max: 0.45,
          p10: 0.37,
        },
      }),
      right: eye({
        openMean: 0.4,
        closedMean: 0.18,
        threshold: 0.29,
        separation: 0.22,
        reopenThreshold: 0.312,
        openSummary: {
          count: 20,
          mean: 0.4,
          min: 0.36,
          max: 0.45,
          p10: 0.37,
        },
      }),
    });
    const monitor = monitorWith(partiallyOpenCalibration);
    monitor.start(0);

    observePair(monitor, 100, 0.15);
    observePair(monitor, 200, 0.15);
    observePair(monitor, 600, 0.15);
    observePair(monitor, 1000, 0.15);
    expect(monitor.getState().status).toBe('prolonged-closure');

    // Partly open, but above both the close and reopen thresholds.
    observePair(monitor, 1050, 0.32);
    observePair(monitor, 1100, 0.32);
    expect(monitor.getState().status).toBe('eyes-open');
    expect(monitor.getState().closureMs).toBe(0);
  });

  it('does not accumulate closure time when only one eye is closed', () => {
    const monitor = monitorWith();
    monitor.start(0);

    observePair(monitor, 100, 0.08, 0.25);
    observePair(monitor, 200, 0.08, 0.25);
    observePair(monitor, 600, 0.08, 0.25);

    expect(monitor.getState().status).toBe('eyes-open');
    expect(monitor.getState().leftClosed).toBe(true);
    expect(monitor.getState().rightClosed).toBe(false);
    expect(monitor.getState().closureMs).toBe(0);
  });

  it('resets the timer and explains a lost face until monitoring is restarted', () => {
    const monitor = monitorWith();
    monitor.start(0);
    observePair(monitor, 100, 0.08);
    observePair(monitor, 200, 0.08);

    monitor.interrupt('face-not-visible');
    expect(monitor.getState().status).toBe('unavailable');
    expect(monitor.getState().reason).toBe('face-not-visible');
    expect(monitor.getState().reasonLabel).toBe('Face not visible');
    expect(monitor.getState().closureMs).toBe(0);

    observePair(monitor, 300, 0.25);
    observePair(monitor, 1000, 0.08);
    expect(monitor.getState().status).toBe('unavailable');
    expect(monitor.getState().closureMs).toBe(0);

    monitor.stop();
    expect(monitor.getState().status).toBe('ready');
    expect(monitor.start(1100)).toBe(true);
    expect(monitor.getState().status).toBe('eyes-open');
  });

  it('reports stale frames and excessive timestamp gaps separately', () => {
    const staleMonitor = monitorWith();
    staleMonitor.start(0);
    staleMonitor.interrupt('stale-frames');
    expect(staleMonitor.getState().reason).toBe('stale-frames');
    expect(staleMonitor.getState().reasonLabel).toBe('Stale frames');

    const gapMonitor = monitorWith();
    gapMonitor.start(0);
    observePair(gapMonitor, 100, 0.08);
    observePair(gapMonitor, 200, 0.08);
    observePair(gapMonitor, 300, 0.08);
    gapMonitor.observe({leftEAR: 0.08, rightEAR: 0.08, atMs: 900});

    expect(gapMonitor.getState().status).toBe('unavailable');
    expect(gapMonitor.getState().reason).toBe('inference-gap');
    expect(gapMonitor.getState().closureMs).toBe(0);

    observePair(gapMonitor, 950, 0.08);
    expect(gapMonitor.getState().reason).toBe('inference-gap');
  });

  it('invalidates monitoring when the calibrated camera resolution changes', () => {
    const monitor = monitorWith();
    monitor.start(0);
    monitor.setResolution({width: 1280, height: 720});

    expect(monitor.getState().status).toBe('unavailable');
    expect(monitor.getState().reason).toBe('resolution-changed');
    expect(monitor.getState().reasonLabel).toBe('Camera resolution changed');
  });

  it('validates the experimental prolonged-closure setting in milliseconds', () => {
    expect(DEFAULT_PROLONGED_CLOSURE_MS).toBe(800);
    expect(validateProlongedClosureMs(250)).toEqual({ok: true, value: 250});
    expect(validateProlongedClosureMs(199).ok).toBe(false);
    expect(validateProlongedClosureMs(5001).ok).toBe(false);
    expect(validateProlongedClosureMs(800.5).ok).toBe(false);
    expect(validateProlongedClosureMs('800').ok).toBe(false);

    const monitor = monitorWith();
    monitor.setProlongedClosureMs(Number.NaN);
    expect(monitor.getProlongedClosureMs()).toBe(DEFAULT_PROLONGED_CLOSURE_MS);
    monitor.setProlongedClosureMs(300);
    expect(monitor.getProlongedClosureMs()).toBe(300);
  });
});
