import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  FaceTrackingController,
  type FaceLandmarkerResultLike,
  type FrameCallback,
  type FrameInfo,
  type FrameScheduler,
  type LandmarkLike,
  type VideoLike,
} from '../faceTrackingController';

interface Harness {
  controller: FaceTrackingController;
  scheduler: FakeScheduler;
  video: VideoLike;
  start: () => Promise<void>;
  advance: () => void;
  setNow: (value: number) => void;
  setEAR: (rightEAR: number, leftEAR: number) => void;
  setResult: (result: FaceLandmarkerResultLike) => void;
  setFaceCount: (count: number) => void;
}

class FakeScheduler implements FrameScheduler {
  private readonly pending = new Map<number, FrameCallback>();
  private nextHandle = 1;

  request(_video: VideoLike, callback: FrameCallback): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(_video: VideoLike, handle: number): void {
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

function createFace(rightEAR: number, leftEAR: number): LandmarkLike[] {
  const landmarks: LandmarkLike[] = Array.from({length: 478}, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const offsetFor = (ear: number) => ear * 0.1;

  const setRight = (index: number, x: number, y: number) => {
    landmarks[index] = {x, y, z: 0, visibility: 1};
  };
  const setEye = (indices: readonly number[], startX: number, ear: number) => {
    const offset = offsetFor(ear);
    setRight(indices[0], startX, 0.4);
    setRight(indices[1], startX + 0.025, 0.4 - offset);
    setRight(indices[2], startX + 0.075, 0.4 - offset);
    setRight(indices[3], startX + 0.1, 0.4);
    setRight(indices[4], startX + 0.075, 0.4 + offset);
    setRight(indices[5], startX + 0.025, 0.4 + offset);
  };

  setEye([33, 160, 158, 133, 153, 144], 0.3, rightEAR);
  setEye([362, 387, 386, 263, 373, 374], 0.6, leftEAR);

  // A relaxed mouth with a non-zero width keeps mouth-baseline samples valid.
  const mouthWidth = 0.24;
  const mouthY = 0.62;
  const lipGap = 0.1 * mouthWidth * 2;
  setRight(61, 0.5 - mouthWidth / 2, mouthY);
  setRight(291, 0.5 + mouthWidth / 2, mouthY);
  setRight(13, 0.5, mouthY - lipGap / 2);
  setRight(14, 0.5, mouthY + lipGap / 2);
  return landmarks;
}

function createVideo(): VideoLike {
  return {currentTime: 0, readyState: 2, videoWidth: 1000, videoHeight: 500};
}

const controllers: FaceTrackingController[] = [];

function createHarness(): Harness {
  const scheduler = new FakeScheduler();
  const video = createVideo();
  let now = 100;
  let frameId = 0;
  let rightEAR = 0.2;
  let leftEAR = 0.24;
  let result: FaceLandmarkerResultLike = {
    faceLandmarks: [createFace(rightEAR, leftEAR)],
  };

  const landmarker = {
    detectForVideo: vi.fn(() => result),
    close: vi.fn(),
  };
  const controller = new FaceTrackingController({
    createLandmarker: async () => landmarker,
    scheduler,
    now: () => now,
  });
  controllers.push(controller);

  const updateResult = () => {
    result = {faceLandmarks: [createFace(rightEAR, leftEAR)]};
  };
  const fireFrame = () => {
    frameId += 1;
    scheduler.fire(scheduler.lastHandle, {
      frameId,
      mediaTime: frameId / 30,
    });
  };

  return {
    controller,
    scheduler,
    video,
    start: () => controller.start(video),
    advance: () => {
      now += 100;
      fireFrame();
    },
    setNow: (value: number) => {
      now = value;
    },
    setEAR: (nextRightEAR: number, nextLeftEAR: number) => {
      rightEAR = nextRightEAR;
      leftEAR = nextLeftEAR;
      updateResult();
    },
    setResult: (nextResult: FaceLandmarkerResultLike) => {
      result = nextResult;
    },
    setFaceCount: (count: number) => {
      result = {
        faceLandmarks: Array.from({length: count}, () =>
          createFace(rightEAR, leftEAR),
        ),
      };
    },
  };
}

async function startTracking(harness: Harness): Promise<void> {
  await harness.start();
  harness.advance(); // Establish one fresh, single-face result.
  expect(harness.controller.getState().facePresence).toBe('single');
}

async function completeCalibration(harness: Harness): Promise<void> {
  harness.setEAR(0.24, 0.2);
  harness.controller.startCalibration();
  expect(harness.controller.getState().calibration.step).toBe('collecting');
  expect(harness.controller.getState().guidedCalibration.instruction).toBe(
    'Look at the camera and relax your mouth. You can blink normally.',
  );

  for (let index = 0; index < 26; index += 1) harness.advance();

  const state = harness.controller.getState();
  expect(state.calibration.step).toBe('success');
  expect(state.mouthBaseline.step).toBe('success');
  expect(state.guidedCalibration.step).toBe('success');
  expect(state.guidedCalibration.instruction).toBe('Calibration complete.');
}

beforeEach(() => {
  vi.stubGlobal('document', {visibilityState: 'visible'});
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

describe('guided calibration and closure monitoring integration', () => {
  it('derives per-eye thresholds, measures sustained closure, and keeps one status source', async () => {
    const harness = createHarness();
    await startTracking(harness);

    harness.setEAR(0.2, 0.24);
    await completeCalibration(harness);

    const calibrated = harness.controller.getState();
    expect(calibrated.calibration.result?.left.threshold).toBeCloseTo(0.15, 5);
    expect(calibrated.calibration.result?.right.threshold).toBeCloseTo(0.19, 5);
    expect(calibrated.calibrationLabel).toBe('Calibrated');
    expect(calibrated.calibrationTone).toBe('teal');
    expect(calibrated.monitoring.status).toBe('ready');
    expect(calibrated.statusLabel).toBe('Ready');

    harness.controller.startMonitoring();
    expect(harness.controller.getState().monitoring.status).toBe('eyes-open');
    expect(harness.controller.getState().statusLabel).toBe(
      'Monitoring: eyes open',
    );

    harness.setEAR(0.08, 0.08);
    for (let index = 0; index < 10; index += 1) harness.advance();

    const prolonged = harness.controller.getState();
    expect(prolonged.monitoring.status).toBe('prolonged-closure');
    expect(prolonged.monitoring.closureMs).toBeGreaterThanOrEqual(800);
    expect(prolonged.statusLabel).toBe('Prolonged eye closure');
    expect(prolonged.monitoringLabel).toBe('Prolonged eye closure');

    harness.controller.stopMonitoring();
    const stopped = harness.controller.getState();
    expect(stopped.monitoring.closureMs).toBe(0);
    expect(stopped.monitoring.status).toBe('ready');
    expect(stopped.statusLabel).toBe('Ready');
  });

  it('rejects calibration without the required tracking preconditions', async () => {
    const harness = createHarness();
    await harness.start();

    harness.controller.startCalibration();
    expect(harness.controller.getState().calibration.failure?.reason).toBe(
      'face-not-single',
    );
    expect(harness.controller.getState().calibrationLabel).toBe(
      'Calibration failed',
    );

    harness.advance();
    harness.setFaceCount(2);
    harness.advance();
    harness.controller.startCalibration();
    expect(harness.controller.getState().calibration.failure?.reason).toBe(
      'face-not-single',
    );

    harness.controller.startMonitoring();
    expect(harness.controller.getState().monitoring.status).toBe(
      'not-calibrated',
    );
  });

  it('keeps monitoring unavailable after tracking loss until restarted', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    harness.controller.startMonitoring();

    harness.setFaceCount(0);
    harness.advance();

    let state = harness.controller.getState();
    expect(state.monitoring.status).toBe('unavailable');
    expect(state.monitoring.reason).toBe('face-not-visible');
    expect(state.monitoring.closureMs).toBe(0);
    expect(state.statusLabel).toBe(
      'Monitoring unavailable — Face not visible',
    );

    harness.setEAR(0.2, 0.24);
    for (let index = 0; index < 3; index += 1) harness.advance();
    state = harness.controller.getState();
    expect(state.monitoring.status).toBe('unavailable');
    expect(state.monitoring.reason).toBe('face-not-visible');

    harness.controller.stopMonitoring();
    harness.controller.startMonitoring();
    harness.advance();
    expect(harness.controller.getState().monitoring.status).toBe('eyes-open');
  });

  it('reports stale frames and timestamp gaps with a reset timer', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    harness.controller.startMonitoring();
    harness.advance();

    harness.setNow(harness.controller.getState().lastInferenceCompletedAtMs! + 1100);
    harness.controller.refreshFreshness();
    expect(harness.controller.getState().monitoring.reason).toBe('stale-frames');
    expect(harness.controller.getState().monitoring.closureMs).toBe(0);

    // Let a fresh frame restore the running tracking phase before restarting.
    harness.advance();
    harness.controller.stopMonitoring();
    harness.controller.startMonitoring();
    harness.advance();
    harness.setNow(harness.controller.getState().lastInferenceCompletedAtMs! + 600);
    harness.controller.refreshFreshness();

    const state = harness.controller.getState();
    expect(state.monitoring.status).toBe('unavailable');
    expect(state.monitoring.reason).toBe('inference-gap');
    expect(state.statusLabel).toBe('Monitoring unavailable — Inference gap');
  });

  it('resets the closure timer when the page becomes hidden', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    harness.controller.startMonitoring();

    harness.setEAR(0.08, 0.08);
    for (let index = 0; index < 6; index += 1) harness.advance();
    expect(harness.controller.getState().monitoring.closureMs).toBeGreaterThan(0);

    harness.controller.setPageVisible(false);
    let state = harness.controller.getState();
    expect(state.monitoring.status).toBe('unavailable');
    expect(state.monitoring.reason).toBe('page-hidden');
    expect(state.monitoring.closureMs).toBe(0);
    expect(state.statusLabel).toBe('Monitoring unavailable — Page hidden');

    harness.controller.setPageVisible(true);
    expect(harness.controller.getState().monitoring.status).toBe('unavailable');

    harness.advance();
    harness.controller.stopMonitoring();
    harness.controller.startMonitoring();
    expect(harness.controller.getState().monitoring.status).toBe('eyes-open');
  });

  it('invalidates calibration and monitoring on camera and resolution changes', async () => {
    const cameraHarness = createHarness();
    await startTracking(cameraHarness);
    await completeCalibration(cameraHarness);
    cameraHarness.controller.startMonitoring();

    cameraHarness.controller.invalidateCalibration('camera-changed');
    const afterCameraChange = cameraHarness.controller.getState();
    expect(afterCameraChange.calibration.result).toBeNull();
    expect(afterCameraChange.calibration.failure?.reason).toBe('camera-changed');
    expect(afterCameraChange.monitoring.status).toBe('not-calibrated');

    const resolutionHarness = createHarness();
    await startTracking(resolutionHarness);
    await completeCalibration(resolutionHarness);
    resolutionHarness.video.videoWidth = 800;
    resolutionHarness.advance();

    const afterResolutionChange = resolutionHarness.controller.getState();
    expect(afterResolutionChange.calibration.result).toBeNull();
    expect(afterResolutionChange.calibration.failure?.reason).toBe(
      'resolution-changed',
    );
    expect(afterResolutionChange.monitoring.status).toBe('not-calibrated');
  });

  it('keeps the face badge teal while the session badge reflects closure severity', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    harness.controller.startMonitoring();

    harness.setEAR(0.08, 0.08);
    for (let index = 0; index < 10; index += 1) harness.advance();

    const state = harness.controller.getState();
    expect(state.monitoring.status).toBe('prolonged-closure');
    expect(state.faceLabel).toBe('One face detected');
    expect(state.faceTone).toBe('teal');
    expect(state.tone).toBe('red');
  });

  it('exposes live diagnostics with close and reopen classification', async () => {
    const harness = createHarness();
    await startTracking(harness);
    await completeCalibration(harness);
    const result = harness.controller.getState().calibration.result!;

    expect(harness.controller.getState().closureDiagnostics.left.closeThreshold).toBe(
      result.left.threshold,
    );
    expect(
      harness.controller.getState().closureDiagnostics.right.reopenThreshold,
    ).toBe(result.right.reopenThreshold);

    harness.controller.startMonitoring();
    harness.setEAR(0.08, 0.08);
    for (let index = 0; index < 10; index += 1) harness.advance();
    expect(harness.controller.getState().closureDiagnostics.left.classification).toBe(
      'closed',
    );

    // Right EAR is above its close threshold but still inside the hysteresis band.
    harness.setEAR(0.195, 0.1);
    harness.advance();
    let rightDiagnostic = harness.controller.getState().closureDiagnostics.right;
    expect(rightDiagnostic.ear).toBeCloseTo(0.195, 5);
    expect(rightDiagnostic.classification).toBe('closed');
    expect(rightDiagnostic.withinHysteresis).toBe(true);

    harness.setEAR(0.25, 0.25);
    harness.advance();
    harness.advance();
    rightDiagnostic = harness.controller.getState().closureDiagnostics.right;
    expect(rightDiagnostic.classification).toBe('open');
    expect(rightDiagnostic.withinHysteresis).toBe(false);
    expect(harness.controller.getState().monitoring.closureMs).toBe(0);
  });
});
