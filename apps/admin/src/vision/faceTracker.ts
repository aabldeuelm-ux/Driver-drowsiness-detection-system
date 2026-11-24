import type {NormalizedPointLike} from './mouthOpening';

const MIN_SIZE = 1e-6;

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scale: number;
}

export interface FaceTrack {
  id: number;
  box: FaceBox;
  lastSeenAt: number;
  missedFrames: number;
  visible: boolean;
}

export interface FaceTrackState {
  tracks: FaceTrack[];
  nextId: number;
}

export interface FaceAssignment {
  detectionIndex: number;
  trackId: number;
  ambiguous: boolean;
}

export interface FaceTrackingFrame {
  state: FaceTrackState;
  assignments: FaceAssignment[];
  visibleTracks: FaceTrack[];
  ambiguousTrackIds: number[];
}

export interface FaceTrackingOptions {
  aspectRatio?: number;
  maxMissedFrames?: number;
  maxMatchCost?: number;
  ambiguityMargin?: number;
}

interface Candidate {
  detectionIndex: number;
  trackId: number;
  cost: number;
}

export function createFaceTrackState(): FaceTrackState {
  return {tracks: [], nextId: 1};
}

export function landmarksToFaceBox(
  landmarks: readonly NormalizedPointLike[],
): FaceBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of landmarks) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const width = Math.max(MIN_SIZE, maxX - minX);
  const height = Math.max(MIN_SIZE, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    scale: Math.max(width, height),
  };
}

function matchCost(
  track: FaceTrack,
  detection: FaceBox,
  aspectRatio: number,
): number | null {
  const scaleA = Math.max(MIN_SIZE, track.box.scale * aspectRatio);
  const scaleB = Math.max(MIN_SIZE, detection.scale * aspectRatio);
  const dx = (track.box.centerX - detection.centerX) * aspectRatio;
  const dy = track.box.centerY - detection.centerY;
  const spatial = Math.hypot(dx, dy) / ((scaleA + scaleB) / 2);
  const size = Math.abs(Math.log(scaleA / scaleB));
  const cost = spatial + size * 1.5;
  return Number.isFinite(cost) ? cost : null;
}

/**
 * Assigns MediaPipe result slots to stable numeric track IDs using only
 * position and size continuity. No face appearance, embedding, or biometric
 * identity is computed or stored.
 */
export function trackFaces(
  previous: FaceTrackState,
  detections: readonly FaceBox[],
  now: number,
  options: FaceTrackingOptions = {},
): FaceTrackingFrame {
  const requestedAspectRatio = options.aspectRatio ?? 1;
  const aspectRatio =
    Number.isFinite(requestedAspectRatio) && requestedAspectRatio > 0
      ? requestedAspectRatio
      : 1;
  const maxMissedFrames = options.maxMissedFrames ?? 2;
  const maxMatchCost = options.maxMatchCost ?? 0.5;
  const ambiguityMargin = options.ambiguityMargin ?? 0.08;

  const eligible = previous.tracks.filter(
    (track) => track.visible || track.missedFrames <= maxMissedFrames,
  );
  const candidates: Candidate[] = [];
  for (const track of eligible) {
    detections.forEach((detection, detectionIndex) => {
      const cost = matchCost(track, detection, aspectRatio);
      if (cost !== null && cost <= maxMatchCost) {
        candidates.push({detectionIndex, trackId: track.id, cost});
      }
    });
  }
  candidates.sort((a, b) => a.cost - b.cost || a.trackId - b.trackId || a.detectionIndex - b.detectionIndex);

  const usedDetections = new Set<number>();
  const usedTracks = new Set<number>();
  const assignedCost = new Map<number, number>();
  const assignments: FaceAssignment[] = [];

  for (const candidate of candidates) {
    if (usedDetections.has(candidate.detectionIndex) || usedTracks.has(candidate.trackId)) continue;
    usedDetections.add(candidate.detectionIndex);
    usedTracks.add(candidate.trackId);
    assignedCost.set(candidate.trackId, candidate.cost);
    assignments.push({detectionIndex: candidate.detectionIndex, trackId: candidate.trackId, ambiguous: false});
  }

  const ambiguousTrackIds = new Set<number>();
  for (const [trackId, cost] of assignedCost) {
    const competing = candidates.some(
      (candidate) =>
        candidate.trackId === trackId &&
        !usedDetections.has(candidate.detectionIndex) &&
        Math.abs(candidate.cost - cost) <= ambiguityMargin,
    );
    if (competing) ambiguousTrackIds.add(trackId);
  }

  const tracksById = new Map(eligible.map((track) => [track.id, track]));
  const nextTracks: FaceTrack[] = [];
  let nextId = previous.nextId;

  for (const assignment of assignments) {
    const old = tracksById.get(assignment.trackId);
    if (!old) continue;
    nextTracks.push({
      id: old.id,
      box: detections[assignment.detectionIndex],
      lastSeenAt: now,
      missedFrames: 0,
      visible: true,
    });
  }

  detections.forEach((box, detectionIndex) => {
    if (usedDetections.has(detectionIndex)) return;
    nextTracks.push({
      id: nextId,
      box,
      lastSeenAt: now,
      missedFrames: 0,
      visible: true,
    });
    assignments.push({detectionIndex, trackId: nextId, ambiguous: false});
    nextId += 1;
  });

  for (const track of eligible) {
    if (usedTracks.has(track.id)) continue;
    const missedFrames = track.missedFrames + 1;
    if (missedFrames <= maxMissedFrames) {
      nextTracks.push({...track, missedFrames, visible: false});
    }
  }

  const finalAssignments = assignments
    .map((assignment) => ({
      ...assignment,
      ambiguous: ambiguousTrackIds.has(assignment.trackId),
    }))
    .sort((a, b) => a.detectionIndex - b.detectionIndex);

  return {
    state: {
      tracks: nextTracks.sort((a, b) => a.id - b.id),
      nextId,
    },
    assignments: finalAssignments,
    visibleTracks: nextTracks.filter((track) => track.visible).sort((a, b) => a.id - b.id),
    ambiguousTrackIds: [...ambiguousTrackIds].sort((a, b) => a - b),
  };
}
