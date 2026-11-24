import {describe, expect, it} from 'vitest';
import {
  CALIBRATION_UNSTABLE_MESSAGE,
} from '../calibration';
import {
  MouthBaselineEngine,
  MOUTH_BASELINE_DURATION_MS,
} from '../mouthBaseline';

function collect(
  engine: MouthBaselineEngine,
  values: readonly number[],
  faceId: number | null = 1,
): void {
  for (let index = 0; index < values.length; index += 1) {
    engine.observe({
      atMs: Math.round((index / (values.length - 1)) * MOUTH_BASELINE_DURATION_MS),
      opening: values[index] ?? 0,
      faceId,
    });
  }
}

function steadyValues(count: number, opening = 0.11): number[] {
  return Array.from({length: count}, () => opening);
}

describe('MouthBaselineEngine', () => {
  it('captures a relaxed-mouth median during the shared session', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    collect(engine, steadyValues(26));

    const state = engine.getState();
    expect(state.step).toBe('success');
    expect(state.relaxedOpening).toBeCloseTo(0.11, 5);
    expect(state.progress).toBe(1);
    expect(state.instruction).toBe('Calibration complete.');
  });

  it('skips talking without discarding valid mouth samples', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    const values = steadyValues(26);
    values[9] = 0.9;
    values[17] = 0.75;
    collect(engine, values);

    const state = engine.getState();
    expect(state.step).toBe('success');
    expect(state.skippedTalkingSamples).toBeGreaterThanOrEqual(2);
    expect(state.relaxedOpening).toBeCloseTo(0.11, 5);
  });

  it('keeps valid samples through a brief tracking interruption', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    for (let index = 0; index < 8; index += 1) {
      engine.observe({atMs: 100 * (index + 1), opening: 0.11, faceId: 1});
    }
    const before = engine.getState();

    engine.observe({atMs: 1800, opening: null, faceId: 1});
    expect(engine.getState().step).toBe('collecting');
    expect(engine.getState().sampleCount).toBe(before.sampleCount);

    for (let index = 0; index < 12; index += 1) {
      engine.observe({atMs: 1900 + index * 100, opening: 0.11, faceId: 1});
    }
    expect(engine.getState().step).toBe('success');
  });

  it('shows one actionable message when tracking stays unstable', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    for (let index = 0; index < 8; index += 1) {
      engine.observe({atMs: 100 * (index + 1), opening: 0.11, faceId: 1});
    }

    engine.onInterruption('tracking-gap', 1000);
    expect(engine.getState().step).toBe('collecting');
    engine.onInterruption('tracking-gap', 2600);

    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().failure?.message).toBe(
      CALIBRATION_UNSTABLE_MESSAGE,
    );
  });

  it('rejects samples from a different spatial face', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    for (let index = 0; index < 8; index += 1) {
      engine.observe({atMs: 100 * (index + 1), opening: 0.11, faceId: 1});
    }

    engine.observe({atMs: 900, opening: 0.9, faceId: 2});
    expect(engine.getState().sampleCount).toBe(8);
    expect(engine.getState().rejectedFaceSamples).toBe(1);
    expect(engine.getState().step).toBe('collecting');
  });

  it('reuses a completed baseline when only the eye baseline retries', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    collect(engine, steadyValues(26));
    const before = engine.getState();

    engine.resume(5000, 1);

    expect(engine.getState().step).toBe('success');
    expect(engine.getState().relaxedOpening).toBe(before.relaxedOpening);
  });

  it('invalidates immediately on face or camera changes', () => {
    const engine = new MouthBaselineEngine();
    engine.begin(0, 1);
    collect(engine, steadyValues(26));
    expect(engine.getState().relaxedOpening).not.toBeNull();

    engine.invalidate('face-selection-changed');
    expect(engine.getState().step).toBe('failed');
    expect(engine.getState().relaxedOpening).toBeNull();
    expect(engine.getState().failure?.message).toContain('new face');
  });
});
