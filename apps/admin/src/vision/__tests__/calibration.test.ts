import {describe, expect, it} from 'vitest';
import {
  CALIBRATION_CLOSED_DURATION_MS,
  CALIBRATION_OPEN_DURATION_MS,
  CALIBRATION_PREPARE_DURATION_MS,
  CalibrationEngine,
  calibrationLabel,
  type CalibrationSample,
} from '../calibration';

const RESOLUTION = {width: 640, height: 480};

function samplesBetween(
  fromExclusive: number,
  toInclusive: number,
  step: number,
  leftEAROrValues: number | readonly number[],
  rightEAROrValues: number | readonly number[] = leftEAROrValues,
): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  let index = 0;
  for (let atMs = fromExclusive + step; atMs <= toInclusive; atMs += step) {
    const left = Array.isArray(leftEAROrValues)
      ? leftEAROrValues[index % leftEAROrValues.length]
      : leftEAROrValues;
    const right = Array.isArray(rightEAROrValues)
      ? rightEAROrValues[index % rightEAROrValues.length]
      : rightEAROrValues;
    samples.push({leftEAR: left ?? 0, rightEAR: right ?? 0, atMs});
    index += 1;
  }
  return samples;
}

function feed(engine: CalibrationEngine, samples: readonly CalibrationSample[]): void {
  for (const sample of samples) engine.observe(sample, RESOLUTION);
}

function completeOpenStage(
  engine: CalibrationEngine,
  leftEAR: number | readonly number[] = 0.2,
  rightEAR: number | readonly number[] = 0.24,
): number {
  const samples = samplesBetween(
    0,
    CALIBRATION_OPEN_DURATION_MS,
    100,
    leftEAR,
    rightEAR,
  );
  feed(engine, samples);
  return CALIBRATION_OPEN_DURATION_MS;
}

function completePreparation(
  engine: CalibrationEngine,
  openEnd: number,
  earlyLeftEAR = 0.2,
  earlyRightEAR = 0.24,
): number {
  const prepareEnd = openEnd + CALIBRATION_PREPARE_DURATION_MS;
  feed(
    engine,
    samplesBetween(
      openEnd,
      prepareEnd,
      100,
      earlyLeftEAR,
      earlyRightEAR,
    ),
  );
  return prepareEnd;
}

function completeClosedStage(
  engine: CalibrationEngine,
  prepareEnd: number,
  leftEAR: number | readonly number[] = 0.1,
  rightEAR: number | readonly number[] = 0.12,
): void {
  feed(
    engine,
    samplesBetween(
      prepareEnd,
      prepareEnd + CALIBRATION_CLOSED_DURATION_MS + 100,
      100,
      leftEAR,
      rightEAR,
    ),
  );
}

function calibratedEngine(): CalibrationEngine {
  const engine = new CalibrationEngine();
  engine.begin(0, RESOLUTION);
  const openEnd = completeOpenStage(engine);
  const prepareEnd = completePreparation(engine, openEnd);
  completeClosedStage(engine, prepareEnd);
  return engine;
}

describe('CalibrationEngine', () => {
  it('derives separate thresholds and capped reopen thresholds after guided stages', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    expect(engine.getState().step).toBe('open');
    expect(engine.getState().instruction).toContain('eyes open');

    const openEnd = completeOpenStage(engine);
    expect(engine.getState().step).toBe('preparing');
    expect(engine.getState().progress).toBeCloseTo(0.5, 5);
    expect(engine.getState().openProgress).toBe(1);
    expect(engine.getState().instruction).toContain('get ready');

    const prepareEnd = completePreparation(engine, openEnd);
    expect(engine.getState().step).toBe('closed');
    expect(engine.getState().prepareProgress).toBe(1);
    expect(engine.getState().instruction).toContain('close both eyes');

    completeClosedStage(engine, prepareEnd);

    const state = engine.getState();
    expect(state.step).toBe('success');
    expect(state.progress).toBe(1);
    expect(calibrationLabel(state)).toBe('Calibrated');
    expect(state.result?.left.threshold).toBeCloseTo(0.15, 5);
    expect(state.result?.right.threshold).toBeCloseTo(0.18, 5);
    expect(state.result?.left.separation).toBeCloseTo(0.1, 5);
    expect(state.result?.right.separation).toBeCloseTo(0.12, 5);
    expect(state.result?.left.openSummary.count).toBe(25);
    expect(state.result?.left.closedSummary.count).toBe(7);
    expect(state.result?.left.reopenThreshold).toBeCloseTo(0.16, 5);
    expect(state.result?.left.reopenThreshold).toBeLessThanOrEqual(
      state.result!.left.openSummary.p10,
    );
    expect(state.result?.resolution).toEqual(RESOLUTION);
  });

  it('rejects invalid EAR samples with an explanatory failure', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    engine.observe({leftEAR: Number.NaN, rightEAR: 0.24, atMs: 100}, RESOLUTION);

    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.reason).toBe('invalid-sample');
    expect(engine.getState().failure?.message).toMatch(/invalid eye measurement/i);
    expect(engine.getState().result).toBeNull();
  });

  it('rejects gaps in the valid sample stream', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    engine.observe({leftEAR: 0.2, rightEAR: 0.24, atMs: 100}, RESOLUTION);
    engine.observe({leftEAR: 0.2, rightEAR: 0.24, atMs: 700}, RESOLUTION);

    expect(engine.getState().failure?.reason).toBe('tracking-gap');
    expect(engine.getState().failure?.message).toMatch(/interrupted/i);
  });

  it('rejects insufficient open-versus-closed separation per eye', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    // Open variation includes a low value; the derived threshold sits close to
    // it, so the closed set cannot be separated from normal open variation.
    const openEnd = completeOpenStage(engine, [0.2, 0.25], [0.2, 0.25]);
    const prepareEnd = completePreparation(engine, openEnd);
    completeClosedStage(engine, prepareEnd, 0.15, 0.15);

    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.reason).toBe('insufficient-separation');
    expect(engine.getState().failure?.message).toMatch(/overlapped|too close/i);
    expect(engine.getState().result).toBeNull();
  });

  it('rejects overlapping sample ranges even when the means differ', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    const openEnd = completeOpenStage(engine, 0.4, 0.4);
    const prepareEnd = completePreparation(engine, openEnd, 0.4, 0.4);
    // One high "closed" sample is accepted by the entry filter but its range
    // still straddles the midpoint threshold.
    completeClosedStage(
      engine,
      prepareEnd,
      [0.35, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      [0.35, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
    );

    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.reason).toBe('insufficient-separation');
    expect(engine.getState().result).toBeNull();
  });

  it('ignores early closure and transition frames instead of shifting thresholds', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    const openEnd = completeOpenStage(engine);
    // Closing during the preparation interval must not enter the closed set.
    const prepareEnd = completePreparation(engine, openEnd, 0.1, 0.12);
    expect(engine.getState().step).toBe('closed');

    feed(
      engine,
      samplesBetween(
        prepareEnd,
        prepareEnd + 200,
        100,
        0.31,
        0.265,
      ),
    );
    feed(
      engine,
      samplesBetween(
        prepareEnd + 200,
        prepareEnd + CALIBRATION_CLOSED_DURATION_MS + 300,
        100,
        0.1,
        0.12,
      ),
    );

    const state = engine.getState();
    expect(state.step).toBe('success');
    expect(state.rejectedClosedSamples).toBeGreaterThanOrEqual(2);
    expect(state.result?.left.closedSummary.max).toBeCloseTo(0.1, 5);
    expect(state.result?.right.closedSummary.max).toBeCloseTo(0.12, 5);
    expect(state.result?.left.threshold).toBeCloseTo(0.15, 5);
    expect(state.result?.right.threshold).toBeCloseTo(0.18, 5);
  });

  it('cancels without keeping partial measurements and can retry cleanly', () => {
    const engine = new CalibrationEngine();
    engine.begin(0, RESOLUTION);
    engine.observe({leftEAR: 0.2, rightEAR: 0.24, atMs: 100}, RESOLUTION);
    engine.cancel();

    expect(engine.getState().step).toBe('cancelled');
    expect(calibrationLabel(engine.getState())).toBe('Calibration cancelled');
    expect(engine.getState().failure?.reason).toBe('cancelled');
    expect(engine.getState().result).toBeNull();

    engine.observe({leftEAR: 0.2, rightEAR: 0.24, atMs: 200}, RESOLUTION);
    expect(engine.getState().step).toBe('cancelled');

    engine.retry(300, RESOLUTION);
    expect(engine.getState().step).toBe('open');
    expect(engine.getState().failure).toBeNull();
    expect(engine.getState().progress).toBe(0);
  });

  it('invalidates a completed calibration when the camera or resolution changes', () => {
    const engine = calibratedEngine();
    expect(engine.getState().result).not.toBeNull();

    engine.invalidate('camera-changed');
    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.reason).toBe('camera-changed');
    expect(engine.getState().result).toBeNull();

    engine.retry(1000, RESOLUTION);
    engine.observe({leftEAR: 0.2, rightEAR: 0.24, atMs: 1100}, {width: 800, height: 600});
    expect(engine.getState().failure?.reason).toBe('resolution-changed');
  });
});
