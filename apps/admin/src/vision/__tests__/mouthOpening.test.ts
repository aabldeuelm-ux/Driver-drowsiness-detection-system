import {describe, expect, it} from 'vitest';
import {
  calculateMouthOpening,
  MOUTH_LEFT_CORNER,
  MOUTH_LOWER_INNER_LIP,
  MOUTH_RIGHT_CORNER,
  MOUTH_UPPER_INNER_LIP,
} from '../mouthOpening';

function landmarks(mouth: Partial<Record<number, {x: number; y: number}>>) {
  const points: {x: number; y: number}[] = Array.from({length: 478}, () => ({x: 0.5, y: 0.5}));
  points[MOUTH_UPPER_INNER_LIP] = {x: 0.5, y: 0.45};
  points[MOUTH_LOWER_INNER_LIP] = {x: 0.5, y: 0.47};
  points[MOUTH_LEFT_CORNER] = {x: 0.4, y: 0.46};
  points[MOUTH_RIGHT_CORNER] = {x: 0.6, y: 0.46};
  for (const [index, point] of Object.entries(mouth)) {
    if (point) points[Number(index)] = point;
  }
  return points;
}

describe('calculateMouthOpening', () => {
  it('normalizes inner-lip separation by mouth width', () => {
    expect(calculateMouthOpening(landmarks({}))).toBeCloseTo(0.1, 5);
  });

  it('increases for a sustained wide opening', () => {
    const open = landmarks({
      [MOUTH_UPPER_INNER_LIP]: {x: 0.5, y: 0.38},
      [MOUTH_LOWER_INNER_LIP]: {x: 0.5, y: 0.54},
    });
    expect(calculateMouthOpening(open)).toBeCloseTo(0.8, 5);
  });

  it('accounts for non-square video aspect ratios', () => {
    const open = landmarks({
      [MOUTH_UPPER_INNER_LIP]: {x: 0.5, y: 0.38},
      [MOUTH_LOWER_INNER_LIP]: {x: 0.5, y: 0.54},
    });
    const square = calculateMouthOpening(open, 1) ?? Number.NaN;
    const wide = calculateMouthOpening(open, 2) ?? Number.NaN;
    expect(wide).toBeLessThan(square);
  });

  it('rejects missing or invalid landmark geometry', () => {
    expect(calculateMouthOpening([])).toBeNull();
    expect(
      calculateMouthOpening(
        landmarks({
          [MOUTH_LEFT_CORNER]: {x: 0.5, y: 0.46},
          [MOUTH_RIGHT_CORNER]: {x: 0.5, y: 0.46},
        }),
      ),
    ).toBeNull();
    expect(
      calculateMouthOpening(landmarks({[MOUTH_LOWER_INNER_LIP]: {x: Number.NaN, y: 0.47}})),
    ).toBeNull();
  });
});
