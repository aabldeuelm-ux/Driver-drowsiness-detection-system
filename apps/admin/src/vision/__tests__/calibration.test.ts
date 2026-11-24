import {describe, expect, it} from 'vitest';
import {
  CALIBRATION_DURATION_MS,
  CALIBRATION_UNSTABLE_MESSAGE,
  CalibrationEngine,
  calibrationLabel,
  type CalibrationSample,
} from '../calibration';

const RESOLUTION = {width: 640, height: 480};

function sample(
  atMs: number,
  leftEAR = 0.2,
  rightEAR = 0.24,
  faceId: number | null = 1,
): CalibrationSample {
  return {atMs, leftEAR, rightEAR, faceId};
}

function feed(
  engine: CalibrationEngine,
  samples: readonly CalibrationSample[],
): void {
  for (const item of samples) engine.observe(item, RESOLUTION);
}

function steadySamples(
  fromMs: number,
  count: number,
  leftEAR = 0.2,
  rightEAR = 0.24,
  faceId: number | null = 1,
): CalibrationSample[] {
  return Array.from({length: count}, (_, index) =>
    sample(fromMs + index * 100, leftEAR, rightEAR, faceId),
  );
}

function calibratedEngine(): CalibrationEngine {
  const engine = new CalibrationEngine();
  engine.begin(0, RESOLUTION, 1);
  feed(
    engine,
    steadySamples(100, Math.ceil(CALIBRATION_DURATION_MS / 100) + 4),
  );
  return engine;
}

describe('CalibrationEngine', () => {
  it('collects both baselines in one session and derives per-eye thresholds', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION, 1);
    expect(engine.getState().step).toBe('collecting');
    expect(engine.getState().instruction).toBe(
      'Look at the camera and relax your mouth. You can blink normally.',
    );

    feed(engine, steadySamples(100, 26));

    const state = engine.getState();
    expect(state.step).toBe('success');
    expect(state.instruction).toBe('Calibration complete.');
    expect(state.progress).toBe(1);
    expect(calibrationLabel(state)).toBe('Calibrated');
    expect(state.result?.faceId).toBe(1);
    expect(state.result?.left.threshold).toBeCloseTo(0.15, 5);
    expect(state.result?.right.threshold).toBeCloseTo(0.19, 5);
    expect(state.result?.left.reopenThreshold).toBeCloseTo(0.16, 5);
    expect(state.result?.left.reopenThreshold).toBeLessThanOrEqual(
      state.result!.left.openSummary.mean,
    );
    expect(state.result?.left.openSummary.count).toBe(22);
    expect(state.result?.resolution).toEqual(RESOLUTION);
  });

  it('skips normal blinks without resetting progress or valid samples', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION, 1);
    feed(engine, steadySamples(100, 8));

    const before = engine.getState();
    expect(before.openSampleCount).toBe(8);
    engine.observe(sample(900, 0.06, 0.08), RESOLUTION);

    const afterBlink = engine.getState();
    expect(afterBlink.step).toBe('collecting');
    expect(afterBlink.openSampleCount).toBe(8);
    expect(afterBlink.skippedBlinkSamples).toBe(1);
    expect(afterBlink.progress).toBeGreaterThanOrEqual(before.progress);

    feed(engine, steadySamples(1000, 18));
    expect(engine.getState().step).toBe('success');
    expect(engine.getState().result?.left.openSummary.count).toBe(21);
  });

  it('keeps valid samples through a brief tracking interruption', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION, 1);
    feed(engine, steadySamples(100, 8));
    const before = engine.getState();

    engine.observe(sample(1800, 0.2, 0.24), RESOLUTION);
    expect(engine.getState().step).toBe('collecting');
    expect(engine.getState().openSampleCount).toBe(before.openSampleCount);

    feed(engine, steadySamples(1900, 8));
    expect(engine.getState().step).toBe('success');
  });

  it('shows one actionable message when tracking stays unstable', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION, 1);
    feed(engine, steadySamples(100, 8));

    engine.onInterruption('tracking-gap', 1000);
    expect(engine.getState().step).toBe('collecting');

    engine.onInterruption('tracking-gap', 2600);
    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.message).toBe(
      CALIBRATION_UNSTABLE_MESSAGE,
    );
  });

  it('rejects samples from a different spatial face without resetting progress', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION, 1);
    feed(engine, steadySamples(100, 8));
    const before = engine.getState();

    feed(engine, steadySamples(900, 5, 0.05, 0.05, 2));

    expect(engine.getState().openSampleCount).toBe(before.openSampleCount);
    expect(engine.getState().rejectedFaceSamples).toBe(5);
    expect(engine.getState().step).toBe('collecting');
  });

  it('reuses a completed eye baseline when only the mouth baseline retries', () => {
    const engine = calibratedEngine();
    const result = engine.getState().result;
    expect(result).not.toBeNull();

    engine.resume(5000, RESOLUTION, 1);

    expect(engine.getState().step).toBe('success');
    expect(engine.getState().result).toBe(result);
    expect(engine.getState().progress).toBe(1);
  });

  it('invalidates a completed calibration on face, camera, or resolution changes', () => {
    const engine = calibratedEngine();
    expect(engine.getState().result).not.toBeNull();

    engine.invalidate('face-selection-changed');
    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.reason).toBe('face-selection-changed');
    expect(engine.getState().result).toBeNull();

    engine.begin(1000, RESOLUTION, 2);
    engine.observe(sample(1100, 0.2, 0.24, 2), {width: 800, height: 600});
    expect(engine.getState().failure?.reason).toBe('resolution-changed');
  });
});
