import {describe, expect, it} from 'vitest';
import {
  landmarksToFaceBox,
  trackFaces,
  type FaceBox,
  type FaceTrack,
} from '../faceTracker';

function box(centerX: number, centerY = 0.5, scale = 0.15): FaceBox {
  const half = scale / 2;
  return {
    x: centerX - half,
    y: centerY - half,
    width: scale,
    height: scale,
    centerX,
    centerY,
    scale,
  };
}

function tracks(...items: Array<[number, number]>): FaceTrack[] {
  return items.map(([id, centerX]) => ({
    id,
    box: box(centerX),
    lastSeenAt: 0,
    missedFrames: 0,
    visible: true,
  }));
}

describe('landmarksToFaceBox', () => {
  it('builds a bounded box from landmarks', () => {
    const result = landmarksToFaceBox([
      {x: 0.2, y: 0.3},
      {x: 0.4, y: 0.7},
    ]);
    expect(result?.x).toBeCloseTo(0.2);
    expect(result?.y).toBeCloseTo(0.3);
    expect(result?.width).toBeCloseTo(0.2);
    expect(result?.height).toBeCloseTo(0.4);
    expect(result?.centerX).toBeCloseTo(0.3);
    expect(result?.centerY).toBeCloseTo(0.5);
  });
});

describe('trackFaces', () => {
  it('keeps IDs stable when MediaPipe returns faces in a different order', () => {
    const previous = {tracks: tracks([1, 0.25], [2, 0.75]), nextId: 3};
    const frame = trackFaces(previous, [box(0.75), box(0.25)], 100);

    expect(frame.assignments).toEqual([
      {detectionIndex: 0, trackId: 2, ambiguous: false},
      {detectionIndex: 1, trackId: 1, ambiguous: false},
    ]);
    expect(frame.visibleTracks.map((track) => track.id)).toEqual([1, 2]);
  });

  it('does not silently transfer a lost selected face to another person', () => {
    const previous = {tracks: tracks([1, 0.25], [2, 0.75]), nextId: 3};
    const frame = trackFaces(previous, [box(0.75)], 100);

    expect(frame.assignments).toEqual([{detectionIndex: 0, trackId: 2, ambiguous: false}]);
    expect(frame.assignments.some((assignment) => assignment.trackId === 1)).toBe(false);
    expect(frame.visibleTracks.map((track) => track.id)).toEqual([2]);
    expect(frame.state.tracks.find((track) => track.id === 1)).toMatchObject({visible: false, missedFrames: 1});
  });

  it('flags ambiguous identity when two faces are nearly equidistant from one track', () => {
    const previous = {tracks: tracks([1, 0.5]), nextId: 2};
    const frame = trackFaces(previous, [box(0.49), box(0.52)], 100);

    expect(frame.ambiguousTrackIds).toContain(1);
    expect(frame.assignments.some((assignment) => assignment.trackId === 1 && assignment.ambiguous)).toBe(true);
  });

  it('assigns entering faces new IDs without reusing a removed ID', () => {
    const previous = {tracks: tracks([1, 0.2], [2, 0.85]), nextId: 3};
    const frame = trackFaces(previous, [box(0.2), box(0.5)], 100);

    const entering = frame.assignments.find((assignment) => assignment.detectionIndex === 1);
    expect(entering?.trackId).toBe(3);
    expect(frame.state.nextId).toBe(4);
  });

  it('drops a track after the configured missed-frame grace period', () => {
    const initial = {tracks: tracks([1, 0.25]), nextId: 2};
    const first = trackFaces(initial, [], 100);
    const second = trackFaces(first.state, [], 200);
    const third = trackFaces(second.state, [], 300);

    expect(first.state.tracks.find((track) => track.id === 1)?.visible).toBe(false);
    expect(second.state.tracks.find((track) => track.id === 1)?.missedFrames).toBe(2);
    expect(third.state.tracks.some((track) => track.id === 1)).toBe(false);
  });
});
