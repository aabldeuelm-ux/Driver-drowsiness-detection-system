export interface NormalizedPointLike {
  x: number;
  y: number;
}

/**
 * Canonical Face Mesh lip landmarks. Face Landmarker keeps the 468-point
 * topology, so these indices remain stable when iris landmarks are returned.
 */
export const MOUTH_UPPER_INNER_LIP = 13;
export const MOUTH_LOWER_INNER_LIP = 14;
export const MOUTH_LEFT_CORNER = 61;
export const MOUTH_RIGHT_CORNER = 291;

const MIN_DENOMINATOR = 1e-6;

function distance(
  a: NormalizedPointLike,
  b: NormalizedPointLike,
  aspectRatio: number,
): number {
  const dx = (a.x - b.x) * aspectRatio;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * A scale-independent mouth-opening measure: inner-lip separation divided by
 * mouth width. Neither the raw frame size nor face identity is stored.
 */
export function calculateMouthOpening(
  landmarks: readonly NormalizedPointLike[],
  aspectRatio = 1,
): number | null {
  const upper = landmarks[MOUTH_UPPER_INNER_LIP];
  const lower = landmarks[MOUTH_LOWER_INNER_LIP];
  const left = landmarks[MOUTH_LEFT_CORNER];
  const right = landmarks[MOUTH_RIGHT_CORNER];
  if (!upper || !lower || !left || !right) return null;

  const values = [upper.x, upper.y, lower.x, lower.y, left.x, left.y, right.x, right.y];
  if (values.some((value) => !Number.isFinite(value))) return null;

  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const width = distance(left, right, safeAspectRatio);
  if (!Number.isFinite(width) || width < MIN_DENOMINATOR) return null;

  const opening = distance(upper, lower, safeAspectRatio) / width;
  return Number.isFinite(opening) && opening >= 0 ? opening : null;
}
