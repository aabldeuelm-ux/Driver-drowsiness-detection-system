import {describe, expect, it} from 'vitest';
import {
  calculateEAR,
  calculateEyeEARs,
  LEFT_EYE_EAR_INDICES,
  RIGHT_EYE_EAR_INDICES,
  type LandmarkPoint,
} from '../earGeometry';

// Independent check: these must stay inside MediaPipe's own per-eye contour
// sets. Docs state "*Left"/"*Right" refer to the subject, not the viewer;
// preview mirroring must not change which index set we call "left".
const MEDIAPIPE_LEFT_EYE = new Set([
  263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384,
  398,
]);
const MEDIAPIPE_RIGHT_EYE = new Set([
  33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157,
  173,
]);

function createLandmarks(): LandmarkPoint[] {
  const landmarks = Array.from({length: 478}, () => ({x: 0.5, y: 0.5}));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = {x, y};
  };

  set(33, 0.3, 0.4);
  set(160, 0.325, 0.38);
  set(158, 0.375, 0.38);
  set(133, 0.4, 0.4);
  set(153, 0.375, 0.42);
  set(144, 0.325, 0.42);

  set(362, 0.6, 0.4);
  set(387, 0.625, 0.38);
  set(386, 0.675, 0.38);
  set(263, 0.7, 0.4);
  set(373, 0.675, 0.42);
  set(374, 0.625, 0.42);

  return landmarks;
}

describe('EAR geometry', () => {
  it('uses pixel distances so non-square images do not distort EAR', () => {
    const landmarks = createLandmarks();

    const wideImage = calculateEAR(landmarks, 1000, 500, RIGHT_EYE_EAR_INDICES);
    const squareImage = calculateEAR(landmarks, 1000, 1000, RIGHT_EYE_EAR_INDICES);

    expect(wideImage).toBeCloseTo(0.2, 5);
    expect(squareImage).toBeCloseTo(0.4, 5);
  });

  it('calculates both subject eyes from the canonical landmark indices', () => {
    const ears = calculateEyeEARs(createLandmarks(), 1000, 500);

    expect(ears.leftEAR).toBeCloseTo(0.2, 5);
    expect(ears.rightEAR).toBeCloseTo(0.2, 5);
  });

  it('keeps subject left/right indices inside MediaPipe per-eye contours', () => {
    expect(LEFT_EYE_EAR_INDICES.every((i) => MEDIAPIPE_LEFT_EYE.has(i))).toBe(true);
    expect(RIGHT_EYE_EAR_INDICES.every((i) => MEDIAPIPE_RIGHT_EYE.has(i))).toBe(
      true,
    );
    expect(LEFT_EYE_EAR_INDICES.every((i) => !MEDIAPIPE_RIGHT_EYE.has(i))).toBe(
      true,
    );
    expect(RIGHT_EYE_EAR_INDICES.every((i) => !MEDIAPIPE_LEFT_EYE.has(i))).toBe(
      true,
    );
  });

  it('returns null for invalid dimensions or landmarks', () => {
    const landmarks = createLandmarks();

    expect(calculateEAR(landmarks, 0, 500, RIGHT_EYE_EAR_INDICES)).toBeNull();
    expect(calculateEAR([], 1000, 500, RIGHT_EYE_EAR_INDICES)).toBeNull();
  });
});
