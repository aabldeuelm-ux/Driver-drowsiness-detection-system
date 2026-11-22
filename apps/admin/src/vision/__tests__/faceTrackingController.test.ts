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

class FakeScheduler implements FrameScheduler {
  private readonly pending = new Map<number, FrameCallback>();
  private readonly callbacks = new Map<number, FrameCallback>();
  private nextHandle = 1;
  requests = 0;
  cancels = 0;

  request(_video: VideoLike, callback: FrameCallback): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    this.callbacks.set(handle, callback);
    this.requests += 1;
    return handle;
  }

  cancel(_video: VideoLike, handle: number): void {
    if (this.pending.delete(handle)) this.cancels += 1;
  }

  fire(handle: number, frame: FrameInfo, force = false): void {
    const callback = force ? this.callbacks.get(handle) : this.pending.get(handle);
    if (!callback) return;
    if (!force) this.pending.delete(handle);
    callback(frame);
  }

  get lastHandle(): number {
    return this.nextHandle - 1;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

function createFace(): LandmarkLike[] {
  const landmarks: LandmarkLike[] = Array.from({length: 478}, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = {x, y, z: 0, visibility: 1};
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

function createVideo(): VideoLike {
  return {currentTime: 0, readyState: 2, videoWidth: 1000, videoHeight: 500};
}

function frame(frameId: number, mediaTime = frameId / 30): FrameInfo {
  return {frameId, mediaTime};
}

let controller: FaceTrackingController | undefined;

beforeEach(() => {
  vi.stubGlobal('document', {visibilityState: 'visible'});
});

afterEach(() => {
  controller?.dispose();
  controller = undefined;
  vi.unstubAllGlobals();
});

describe('FaceTrackingController', () => {
  it('records frame arrival and completed inference with one monotonic clock', async () => {
    let now = 100;
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn((): FaceLandmarkerResultLike => {
        now += 20; // Simulate a slow inference call.
        return {faceLandmarks: [createFace()]};
      }),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => now,
    });

    await controller.start(createVideo());
    expect(controller.getState().phase).toBe('running');
    expect(controller.getState().fpsPhase).toBe('warming-up');

    scheduler.fire(scheduler.lastHandle, frame(1, 0));

    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    expect(controller.getState().measurements?.leftEAR).toBeCloseTo(0.2, 5);
    expect(controller.getState().lastFrameArrivalAtMs).toBe(100);
    expect(controller.getState().lastInferenceCompletedAtMs).toBe(120);
    expect(controller.getState().lastFrameAgeMs).toBe(20);
    expect(controller.getState().lastInferenceAgeMs).toBe(0);
  });

  it('deduplicates by presentedFrames when live mediaTime stays zero', async () => {
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    scheduler.fire(scheduler.lastHandle, frame(1, 0));
    scheduler.fire(scheduler.lastHandle, frame(2, 0));
    scheduler.fire(scheduler.lastHandle, frame(3, 0));

    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(3);
  });

  it('keeps snapshot-canvas freshness tied to new decoded frames', async () => {
    let now = 100;
    const scheduler = new FakeScheduler();
    const source = {
      currentTime: 0,
      readyState: 4,
      videoWidth: 320,
      videoHeight: 240,
    };
    const landmarker = {
      detectForVideo: vi.fn((frameSource: unknown) => {
        expect(frameSource).toBe(source);
        return {faceLandmarks: [createFace()]};
      }),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => now,
    });

    await controller.start(source);
    scheduler.fire(scheduler.lastHandle, frame(source.currentTime));
    expect(controller.getState().lastFrameArrivalAtMs).toBe(100);

    // The ESP32 controller increments currentTime only after decoding a JPEG.
    now = 200;
    source.currentTime += 1;
    scheduler.fire(scheduler.lastHandle, frame(source.currentTime));
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    expect(controller.getState().lastFrameArrivalAtMs).toBe(200);

    // A requestAnimationFrame poll with the same identity is not a new frame.
    now = 300;
    scheduler.fire(scheduler.lastHandle, frame(source.currentTime));
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    expect(controller.getState().lastFrameArrivalAtMs).toBe(200);
  });

  it('processes a changed frame once and clears measurements on tracking loss', async () => {
    const scheduler = new FakeScheduler();
    const face = createFace();
    let currentResult: FaceLandmarkerResultLike = {faceLandmarks: [face]};
    const landmarker = {
      detectForVideo: vi.fn(() => currentResult),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    scheduler.fire(scheduler.lastHandle, frame(1));
    expect(controller.getState().measurements).not.toBeNull();

    scheduler.fire(scheduler.lastHandle, frame(1));
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);

    currentResult = {faceLandmarks: []};
    scheduler.fire(scheduler.lastHandle, frame(2));
    expect(controller.getState().faceLabel).toBe('No face detected');
    expect(controller.getState().measurements).toBeNull();
    expect(controller.getState().landmarks).toBeNull();

    currentResult = {faceLandmarks: [face, face]};
    scheduler.fire(scheduler.lastHandle, frame(3));
    expect(controller.getState().faceLabel).toBe(
      'Monitoring problem: multiple faces',
    );
    expect(controller.getState().measurements).toBeNull();
  });

  it('reports warm-up then actual completed-inference FPS over a rolling window', async () => {
    let now = 100;
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => now,
    });

    await controller.start(createVideo());

    scheduler.fire(scheduler.lastHandle, frame(1));
    expect(controller.getState().fpsPhase).toBe('warming-up');
    expect(controller.getState().inferenceFps).toBeNull();

    now = 600;
    scheduler.fire(scheduler.lastHandle, frame(2));
    expect(controller.getState().fpsPhase).toBe('measuring');
    expect(controller.getState().inferenceFps).toBeCloseTo(2, 5);

    now = 1100;
    scheduler.fire(scheduler.lastHandle, frame(3));
    expect(controller.getState().inferenceFps).toBeCloseTo(2, 5);

    now = 1600;
    scheduler.fire(scheduler.lastHandle, frame(4));

    now = 2600;
    scheduler.fire(scheduler.lastHandle, frame(5));
    expect(controller.getState().inferenceFps).toBeCloseTo(1.5, 5);
  });

  it('distinguishes stopped camera frames from stalled inference', async () => {
    let now = 100;
    const cameraStoppedScheduler = new FakeScheduler();
    const goodLandmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => goodLandmarker,
      scheduler: cameraStoppedScheduler,
      now: () => now,
      staleAfterMs: 1000,
    });

    await controller.start(createVideo());
    cameraStoppedScheduler.fire(cameraStoppedScheduler.lastHandle, frame(1));
    expect(controller.getState().measurements).not.toBeNull();

    now = 1300;
    controller.refreshFreshness();

    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().staleReason).toBe('camera-frames-stopped');
    expect(controller.getState().faceLabel).toBe(
      'Monitoring problem: camera frames stopped',
    );
    expect(controller.getState().measurements).toBeNull();
    expect(controller.getState().landmarks).toBeNull();
    expect(controller.getState().inferenceFps).toBeNull();

    controller.dispose();

    const stalledScheduler = new FakeScheduler();
    const failingLandmarker = {
      detectForVideo: vi.fn(() => {
        throw new Error('transient frame error');
      }),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => failingLandmarker,
      scheduler: stalledScheduler,
      now: () => now,
      staleAfterMs: 1000,
    });

    now = 2000;
    await controller.start(createVideo());
    stalledScheduler.fire(stalledScheduler.lastHandle, frame(10));
    now = 2100;
    stalledScheduler.fire(stalledScheduler.lastHandle, frame(11));

    now = 3100;
    stalledScheduler.fire(stalledScheduler.lastHandle, frame(12));
    controller.refreshFreshness();

    expect(controller.getState().staleReason).toBe('inference-stalled');
    expect(controller.getState().faceLabel).toBe(
      'Monitoring problem: inference stalled',
    );
    expect(controller.getState().measurements).toBeNull();
  });

  it('continues after a recoverable inference error without starting a second loop', async () => {
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('temporary frame error');
        })
        .mockImplementation(
          (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
        ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    scheduler.fire(scheduler.lastHandle, frame(1));

    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().error?.code).toBe('runtime');
    expect(controller.getState().error?.retryable).toBe(false);
    expect(scheduler.pendingCount).toBe(1);

    scheduler.fire(scheduler.lastHandle, frame(2));

    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    expect(controller.getState().phase).toBe('running');
    expect(controller.getState().error).toBeNull();
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.requests).toBe(3);
  });

  it('cancels pending inference on stop and ignores a late callback', async () => {
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    scheduler.fire(scheduler.lastHandle, frame(1));
    const pendingHandle = scheduler.lastHandle;
    expect(controller.getState().measurements).not.toBeNull();
    expect(scheduler.pendingCount).toBe(1);

    controller.stopSession();

    expect(controller.getState().phase).toBe('ready');
    expect(controller.getState().measurements).toBeNull();
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.cancels).toBeGreaterThan(0);

    const callsAfterStop = landmarker.detectForVideo.mock.calls.length;
    scheduler.fire(pendingHandle, frame(2), true);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(callsAfterStop);

    controller.dispose();
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it('reports model-download failures as retryable and recovers on retry', async () => {
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };
    const createLandmarker = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch model asset'))
      .mockResolvedValueOnce(landmarker);

    controller = new FaceTrackingController({
      createLandmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    expect(controller.getState().phase).toBe('error');
    expect(controller.getState().error?.code).toBe('model-download');
    expect(controller.getState().error?.retryable).toBe(true);

    await controller.retry();
    expect(controller.getState().phase).toBe('running');
    expect(createLandmarker).toHaveBeenCalledTimes(2);
  });

  it('pauses on visibility loss, resumes once, and detects a missed hide event', async () => {
    const scheduler = new FakeScheduler();
    const landmarker = {
      detectForVideo: vi.fn(
        (): FaceLandmarkerResultLike => ({faceLandmarks: [createFace()]}),
      ),
      close: vi.fn(),
    };

    controller = new FaceTrackingController({
      createLandmarker: async () => landmarker,
      scheduler,
      now: () => 100,
    });

    await controller.start(createVideo());
    scheduler.fire(scheduler.lastHandle, frame(1));
    expect(controller.getState().measurements).not.toBeNull();

    controller.setPageVisible(false);
    expect(controller.getState().phase).toBe('paused');
    expect(controller.getState().measurements).toBeNull();
    expect(scheduler.pendingCount).toBe(0);

    controller.setPageVisible(true);
    expect(controller.getState().phase).toBe('running');
    expect(controller.getState().fpsPhase).toBe('warming-up');
    expect(scheduler.pendingCount).toBe(1);

    const callsBeforeResume = landmarker.detectForVideo.mock.calls.length;
    scheduler.fire(scheduler.lastHandle, frame(2));
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(callsBeforeResume + 1);
    expect(scheduler.pendingCount).toBe(1);

    vi.stubGlobal('document', {visibilityState: 'hidden'});
    controller.refreshFreshness();
    expect(controller.getState().phase).toBe('paused');
  });
});
