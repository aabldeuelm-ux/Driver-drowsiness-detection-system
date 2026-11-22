import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DeviceCameraController} from '../deviceCameraController';

interface FakeTrack {
  stopped: boolean;
  readyState: MediaStreamTrackState;
  stop: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  getSettings: () => MediaTrackSettings;
  dispatchEnded: () => void;
}

function createFakeTrack(
  deviceId: string,
  width = 1280,
  height = 720,
): FakeTrack {
  const listeners = new Set<() => void>();
  const track: FakeTrack = {
    stopped: false,
    readyState: 'live',
    stop: () => {
      track.stopped = true;
      track.readyState = 'ended';
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    getSettings: () => ({deviceId, width, height}),
    dispatchEnded: () => {
      for (const listener of listeners) listener();
    },
  };
  return track;
}

function createFakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

function createFakeDevice(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    kind: 'videoinput',
    label,
    groupId: 'group-1',
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

interface FakeMediaDevices {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

let mediaDevices: FakeMediaDevices;

beforeEach(() => {
  mediaDevices = {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([
      createFakeDevice('cam-a', 'FaceTime HD Camera'),
      createFakeDevice('cam-b', 'External Webcam'),
    ]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  vi.stubGlobal('navigator', {mediaDevices});
  vi.stubGlobal('window', {
    isSecureContext: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeviceCameraController', () => {
  it('requests video only and stops previous tracks when switching cameras', async () => {
    const trackA = createFakeTrack('cam-a');
    const trackB = createFakeTrack('cam-b', 640, 480);

    mediaDevices.getUserMedia
      .mockResolvedValueOnce(createFakeStream(trackA))
      .mockResolvedValueOnce(createFakeStream(trackB));

    const controller = new DeviceCameraController();
    await controller.start();

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: expect.objectContaining({width: {ideal: 1280}, height: {ideal: 720}}),
      audio: false,
    });
    expect(trackA.stopped).toBe(false);

    await controller.selectDevice('cam-b');

    expect(trackA.stopped).toBe(true);
    expect(trackB.stopped).toBe(false);
    expect(controller.getState().status).toBe('live');
    expect(controller.getState().resolution).toEqual({width: 640, height: 480});

    controller.stop();

    expect(trackB.stopped).toBe(true);
    expect(controller.getState().stream).toBeNull();
  });

  it('stops a late stream when Stop was clicked before permission resolved', async () => {
    const pending = deferred<MediaStream>();
    const track = createFakeTrack('cam-a');
    mediaDevices.getUserMedia.mockReturnValue(pending.promise);

    const controller = new DeviceCameraController();
    const request = controller.start();

    controller.stop();
    pending.resolve(createFakeStream(track));
    await request;

    expect(track.stopped).toBe(true);
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().stream).toBeNull();
  });

  it('ignores a stale permission response after a newer request', async () => {
    const firstRequest = deferred<MediaStream>();
    const trackA = createFakeTrack('cam-a');
    const trackB = createFakeTrack('cam-b');

    mediaDevices.getUserMedia
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(createFakeStream(trackB));

    const controller = new DeviceCameraController();
    const first = controller.start('cam-a');
    const second = controller.start('cam-b');

    await second;
    expect(controller.getState().status).toBe('live');
    expect(controller.getState().selectedDeviceId).toBe('cam-b');

    firstRequest.resolve(createFakeStream(trackA));
    await first;

    expect(trackA.stopped).toBe(true);
    expect(trackB.stopped).toBe(false);
    expect(controller.getState().stream?.getVideoTracks()[0]).toBe(trackB);
  });

  it('maps permission denial to a retryable error', async () => {
    const denied = Object.assign(new Error('denied'), {name: 'NotAllowedError'});
    mediaDevices.getUserMedia.mockRejectedValue(denied);

    const controller = new DeviceCameraController();
    await controller.start();

    expect(controller.getState().status).toBe('error');
    expect(controller.getState().error?.code).toBe('permission-denied');
    expect(controller.getState().error?.retryable).toBe(true);
  });

  it('stops tracks on dispose and allows a fresh start after revive', async () => {
    const trackA = createFakeTrack('cam-a');
    const trackB = createFakeTrack('cam-b');

    mediaDevices.getUserMedia
      .mockResolvedValueOnce(createFakeStream(trackA))
      .mockResolvedValueOnce(createFakeStream(trackB));

    const controller = new DeviceCameraController();
    controller.revive();
    await controller.start();
    controller.dispose();

    expect(trackA.stopped).toBe(true);
    expect(mediaDevices.removeEventListener).toHaveBeenCalled();

    controller.revive();
    await controller.start();

    expect(trackB.stopped).toBe(false);
    expect(controller.getState().status).toBe('live');
  });
});
