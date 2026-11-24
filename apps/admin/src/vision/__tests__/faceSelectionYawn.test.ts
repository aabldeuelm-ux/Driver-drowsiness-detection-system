import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  FaceTrackingController,
  type FaceCandidate,
  type FaceLandmarkerResultLike,
  type FrameCallback,
  type FrameInfo,
  type FrameScheduler,
  type LandmarkLike,
  type YawnAlert,
} from '../faceTrackingController';

interface FaceSpec {
  centerX?: number;
  ear?: number;
  mouth?: number;
}

interface Harness {
  controller: FaceTrackingController;
  start: () => Promise<void>;
  advance: () => void;
  setFaces: (faces: FaceSpec[]) => void;
  updateFace: (index: number, patch: FaceSpec) => void;
  getFaces: () => FaceSpec[];
  yawnAlerts: YawnAlert[];
}

class FakeScheduler implements FrameScheduler {
  private readonly pending = new Map<number, FrameCallback>();
  private nextHandle = 1;

  request(_video: unknown, callback: FrameCallback): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(_video: unknown, handle: number): void {
    this.pending.delete(handle);
  }

  fire(handle: number, frame: FrameInfo): void {
    const callback = this.pending.get(handle);
    if (!callback) return;
    this.pending.delete(handle);
    callback(frame);
  }

  get lastHandle(): number {
    return this.nextHandle - 1;
  }
}

function createFace(spec: FaceSpec): LandmarkLike[] {
  const centerX = spec.centerX ?? 0.5;
  const ear = spec.ear ?? 0.2;
  const mouth = spec.mouth ?? 0.1;
  const landmarks: LandmarkLike[] = Array.from({length: 478}, () => ({
    x: centerX,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = {x, y, z: 0, visibility: 1};
  };

  const eyeOffset = ear * 0.1;
  const setEye = (indices: readonly number[], startX: number) => {
    set(indices[0], startX, 0.4);
    set(indices[1], startX + 0.025, 0.4 - eyeOffset);
    set(indices[2], startX + 0.075, 0.4 - eyeOffset);
    set(indices[3], startX + 0.1, 0.4);
    set(indices[4], startX + 0.075, 0.4 + eyeOffset);
    set(indices[5], startX + 0.025, 0.4 + eyeOffset);
  };
  setEye([33, 160, 158, 133, 153, 144], centerX - 0.2);
  setEye([362, 387, 386, 263, 373, 374], centerX + 0.1);

  const mouthWidth = 0.24;
  const mouthY = 0.62;
  // Video is 1000×500, so projected width is mouthWidth × 2. This makes the
  // normalized inner-lip ratio equal to the requested `mouth` value.
  const lipGap = mouth * mouthWidth * 2;
  set(61, centerX - mouthWidth / 2, mouthY);
  set(291, centerX + mouthWidth / 2, mouthY);
  set(13, centerX, mouthY - lipGap / 2);
  set(14, centerX, mouthY + lipGap / 2);

  return landmarks;
}

const controllers: FaceTrackingController[] = [];

function createHarness(initialFaces: FaceSpec[] = [{centerX: 0.5}]): Harness {
  const scheduler = new FakeScheduler();
  let now = 100;
  let frameId = 0;
  let faces = initialFaces.map((face) => ({...face}));
  let result: FaceLandmarkerResultLike = {faceLandmarks: faces.map(createFace)};
  const yawnAlerts: YawnAlert[] = [];
  const controller = new FaceTrackingController({
    createLandmarker: async () => ({
      detectForVideo: vi.fn(() => result),
      close: vi.fn(),
    }),
    scheduler,
    now: () => now,
  });
  controllers.push(controller);
  controller.subscribe((state) => {
    const alert = state.yawnAlert;
    if (alert && yawnAlerts.at(-1)?.id !== alert.id) yawnAlerts.push(alert);
  });

  const updateResult = () => {
    result = {faceLandmarks: faces.map(createFace)};
  };
  updateResult();

  return {
    controller,
    yawnAlerts,
    start: () =>
      controller.start({
        currentTime: 0,
        readyState: 2,
        videoWidth: 1000,
        videoHeight: 500,
      }),
    advance: () => {
      now += 100;
      frameId += 1;
      scheduler.fire(scheduler.lastHandle, {frameId, mediaTime: frameId / 30});
    },
    setFaces: (nextFaces) => {
      faces = nextFaces.map((face) => ({...face}));
      updateResult();
    },
    updateFace: (index, patch) => {
      faces = faces.map((face, faceIndex) =>
        faceIndex === index ? {...face, ...patch} : face,
      );
      updateResult();
    },
    getFaces: () => faces.map((face) => ({...face})),
  };
}

async function startTracking(harness: Harness): Promise<void> {
  await harness.start();
  harness.advance();
  expect(harness.controller.getState().facePresence).toBe('single');
}

async function completeCalibration(
  harness: Harness,
  selectedFaceIndex = 0,
): Promise<void> {
  const faces = harness.getFaces();
  harness.setFaces(
    faces.map((face, index) => ({
      ...face,
      ear: 0.2,
      mouth: index === selectedFaceIndex ? 0.1 : face.mouth,
    })),
  );
  harness.controller.startCalibration();
  for (let index = 0; index < 26; index += 1) harness.advance();

  const state = harness.controller.getState();
  expect(state.calibration.step).toBe('success');
  expect(state.mouthBaseline.step).toBe('success');
  expect(state.guidedCalibration.step).toBe('success');
  expect(state.guidedCalibration.instruction).toBe('Calibration complete.');
}

function faceAt(centerX: number, mouth = 0.1): FaceSpec {
  return {centerX, ear: 0.2, mouth};
}

function candidateNear(
  candidates: readonly FaceCandidate[],
  centerX: number,
): FaceCandidate {
  const candidate = candidates.reduce((best, current) =>
    Math.abs(current.box.centerX - centerX) < Math.abs(best.box.centerX - centerX)
      ? current
      : best,
  );
  return candidate;
}

beforeEach(() => {
  vi.stubGlobal('document', {visibilityState: 'visible'});
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

describe('one-click guided calibration', () => {
  it('completes with one click after the user selects a face', async () => {
    const harness = createHarness([faceAt(0.35, 0.1), faceAt(0.65, 0.1)]);
    await harness.start();
    harness.advance();
    expect(harness.controller.getState().facePresence).toBe('multiple');

    const target = candidateNear(
      harness.controller.getState().faceCandidates,
      0.35,
    );
    harness.controller.selectFace(target.id);
    harness.advance();
    expect(harness.controller.getState().selectionPrompt).toBeNull();
    expect(harness.controller.getState().facePresence).toBe('single');

    harness.controller.startCalibration();
    for (let index = 0; index < 26; index += 1) harness.advance();

    const state = harness.controller.getState();
    expect(state.calibration.step).toBe('success');
    expect(state.mouthBaseline.step).toBe('success');
    expect(state.guidedCalibration.step).toBe('success');
    expect(state.calibration.result?.faceId).toBe(target.id);
  });

  it('ignores eye and mouth samples from an unselected face', async () => {
    const harness = createHarness([faceAt(0.35, 0.1), faceAt(0.65, 0.1)]);
    await harness.start();
    harness.advance();
    const target = candidateNear(
      harness.controller.getState().faceCandidates,
      0.35,
    );
    harness.controller.selectFace(target.id);
    harness.advance();
    harness.updateFace(1, {ear: 0.04, mouth: 0.9});

    harness.controller.startCalibration();
    for (let index = 0; index < 26; index += 1) harness.advance();

    const state = harness.controller.getState();
    expect(state.calibration.result?.left.threshold).toBeCloseTo(0.15, 5);
    expect(state.calibration.result?.right.threshold).toBeCloseTo(0.15, 5);
    expect(state.mouthBaseline.relaxedOpening).toBeCloseTo(0.1, 5);
    expect(state.calibration.result?.faceId).toBe(target.id);
  });

  it('does not reset progress when the selected person blinks normally', async () => {
    const harness = createHarness();
    await startTracking(harness);
    harness.controller.startCalibration();
    for (let index = 0; index < 8; index += 1) harness.advance();

    const before = harness.controller.getState();
    expect(before.calibration.openSampleCount).toBeGreaterThan(0);
    harness.updateFace(0, {ear: 0.06});
    harness.advance();
    harness.updateFace(0, {ear: 0.2});

    const afterBlink = harness.controller.getState();
    expect(afterBlink.calibration.step).toBe('collecting');
    expect(afterBlink.calibration.openSampleCount).toBe(
      before.calibration.openSampleCount,
    );
    expect(afterBlink.calibration.skippedBlinkSamples).toBeGreaterThanOrEqual(1);

    for (let index = 0; index < 20; index += 1) harness.advance();
    expect(harness.controller.getState().guidedCalibration.step).toBe('success');
  });

  it('keeps a completed eye baseline and retries only the unfinished mouth baseline', async () => {
    const harness = createHarness();
    await startTracking(harness);
    harness.controller.startCalibration();
    for (let index = 0; index < 26; index += 1) {
      harness.updateFace(0, {mouth: index % 5 === 0 ? 0.1 : 0.5});
      harness.advance();
    }

    const failed = harness.controller.getState();
    expect(failed.calibration.step).toBe('success');
    expect(failed.mouthBaseline.step).toBe('failed');
    expect(failed.guidedCalibration.step).toBe('failed');
    expect(failed.guidedCalibration.eyesReady).toBe(true);
    expect(failed.guidedCalibration.mouthReady).toBe(false);
    const eyeResult = failed.calibration.result;

    harness.updateFace(0, {mouth: 0.1});
    harness.controller.startCalibration();
    for (let index = 0; index < 26; index += 1) harness.advance();

    const recovered = harness.controller.getState();
    expect(recovered.calibration.result).toEqual(eyeResult);
    expect(recovered.mouthBaseline.step).toBe('success');
    expect(recovered.guidedCalibration.step).toBe('success');
  });
});

describe('face selection and possible-yawn alerts', () => {
  it('emits one browser-only alert per sustained selected-face mouth opening', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    harness.controller.startMonitoring();

    harness.updateFace(0, {mouth: 0.8});
    for (let index = 0; index < 9; index += 1) harness.advance();
    expect(harness.yawnAlerts).toHaveLength(1);
    expect(harness.yawnAlerts[0]?.durationMs).toBeGreaterThanOrEqual(800);

    for (let index = 0; index < 4; index += 1) harness.advance();
    expect(harness.yawnAlerts).toHaveLength(1);

    harness.updateFace(0, {mouth: 0.1});
    harness.advance();
    harness.advance();
    harness.updateFace(0, {mouth: 0.8});
    for (let index = 0; index < 9; index += 1) harness.advance();
    expect(harness.yawnAlerts).toHaveLength(2);
    expect(harness.yawnAlerts[1]?.id).not.toBe(harness.yawnAlerts[0]?.id);
  });

  it('ignores a sustained mouth opening from an unselected face', async () => {
    const harness = createHarness([faceAt(0.35, 0.1), faceAt(0.65, 0.8)]);
    await harness.start();
    harness.advance();
    const calm = candidateNear(harness.controller.getState().faceCandidates, 0.35);
    harness.controller.selectFace(calm.id);
    harness.advance();
    await completeCalibration(harness, 0);
    harness.controller.startMonitoring();

    for (let index = 0; index < 12; index += 1) harness.advance();

    expect(harness.yawnAlerts).toHaveLength(0);
    expect(harness.controller.getState().yawn.opening).toBeCloseTo(0.1, 2);
    expect(harness.controller.getState().yawn.status).toBe('watching');
  });

  it('pauses on selected-face loss and resumes only after an explicit reselect', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    const selectedId = harness.controller.getState().faceCandidates[0]?.id;
    expect(selectedId).toBeDefined();
    harness.controller.selectFace(selectedId!);
    harness.controller.startMonitoring();

    harness.updateFace(0, {ear: 0.1});
    for (let index = 0; index < 3; index += 1) harness.advance();
    expect(harness.controller.getState().monitoring.closureMs).toBeGreaterThan(0);

    harness.setFaces([]);
    harness.advance();
    const lost = harness.controller.getState();
    expect(lost.selectionPrompt).toContain('Selected face is not visible');
    expect(lost.monitoring.status).toBe('unavailable');
    expect(lost.monitoring.closureMs).toBe(0);

    harness.setFaces([faceAt(0.8, 0.1)]);
    harness.advance();
    expect(harness.controller.getState().selectionPrompt).toContain(
      'Selected face was lost',
    );
    expect(harness.controller.getState().monitoring.status).toBe('unavailable');

    harness.setFaces([faceAt(0.5, 0.1)]);
    harness.advance();
    expect(harness.controller.getState().selectionPrompt).not.toBeNull();
    expect(harness.controller.getState().monitoring.status).toBe('unavailable');

    harness.controller.selectFace(selectedId!);
    expect(harness.controller.getState().monitoring.status).toBe('unavailable');
    harness.advance();
    const resumed = harness.controller.getState();
    expect(resumed.selectionPrompt).toBeNull();
    expect(resumed.monitoring.status).toBe('eyes-open');
    expect(resumed.monitoring.active).toBe(true);
  });

  it('pauses and asks for reselect when spatial identity is ambiguous', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    const selectedId = harness.controller.getState().faceCandidates[0]?.id;
    expect(selectedId).toBeDefined();
    harness.controller.selectFace(selectedId!);
    harness.controller.startMonitoring();

    harness.setFaces([faceAt(0.49, 0.1), faceAt(0.51, 0.1)]);
    harness.advance();

    const state = harness.controller.getState();
    expect(state.facePresence).toBe('multiple');
    expect(state.selectionPrompt).toContain('ambiguous');
    expect(state.monitoring.status).toBe('not-calibrated');
    expect(state.monitoring.closureMs).toBe(0);
    expect(state.measurements).toBeNull();
    expect(state.calibration.result).toBeNull();
    expect(state.calibration.failure?.reason).toBe('face-selection-changed');
    expect(state.guidedCalibration.step).toBe('failed');
  });
});
