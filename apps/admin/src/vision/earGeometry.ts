export interface LandmarkPoint {
  x: number;
  y: number;
}

/**
 * Six-point EAR indices from the MediaPipe Face Mesh canonical topology.
 * Left/right refer to the subject, not the viewer.
 */
export const RIGHT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144] as const;
export const LEFT_EYE_EAR_INDICES = [362, 387, 386, 263, 373, 374] as const;

export const EYE_OUTLINES = [
  RIGHT_EYE_EAR_INDICES,
  LEFT_EYE_EAR_INDICES,
] as const;

function distance(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Calculates eye aspect ratio in pixel space. MediaPipe landmarks are
 * normalized to [0, 1], so multiplying by the actual image dimensions is
 * required before measuring distances; otherwise a non-square image would
 * distort the ratio.
 */
export function calculateEAR(
  landmarks: readonly LandmarkPoint[],
  imageWidth: number,
  imageHeight: number,
  indices: readonly number[],
): number | null {
  if (
    !Number.isFinite(imageWidth) ||
    imageWidth <= 0 ||
    !Number.isFinite(imageHeight) ||
    imageHeight <= 0 ||
    indices.length !== 6
  ) {
    return null;
  }

  const points = indices.map((index) => landmarks[index]);
  if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return null;
  }

  const [p1, p2, p3, p4, p5, p6] = points.map((point) => ({
    x: point.x * imageWidth,
    y: point.y * imageHeight,
  }));

  const horizontal = distance(p1, p4);
  if (!Number.isFinite(horizontal) || horizontal === 0) {
    return null;
  }

  const ear = (distance(p2, p6) + distance(p3, p5)) / (2 * horizontal);
  return Number.isFinite(ear) ? ear : null;
}

export interface EyeEARs {
  leftEAR: number | null;
  rightEAR: number | null;
}

export function calculateEyeEARs(
  landmarks: readonly LandmarkPoint[],
  imageWidth: number,
  imageHeight: number,
): EyeEARs {
  return {
    leftEAR: calculateEAR(landmarks, imageWidth, imageHeight, LEFT_EYE_EAR_INDICES),
    rightEAR: calculateEAR(landmarks, imageWidth, imageHeight, RIGHT_EYE_EAR_INDICES),
  };
}
