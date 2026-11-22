import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  Esp32SnapshotController,
  type DecodedJpegLike,
  type Esp32SnapshotState,
  type SnapshotFrameCanvas,
} from '../esp32SnapshotController';

interface FakeCanvas {
  canvas: SnapshotFrameCanvas;
  drawImage: ReturnType<typeof vi.fn>;
}

function createFakeCanvas(): FakeCanvas {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    currentTime: 0,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    getContext: vi.fn(() => ({drawImage})),
  } as unknown as SnapshotFrameCanvas;
  return {canvas, drawImage};
}

function createBitmap(width = 320, height = 240): DecodedJpegLike {
  return {width, height, close: vi.fn()};
}

function createJpegResponse(options: {
  status?: number;
  contentType?: string;
  bytes?: number;
  headers?: Record<string, string>;
} = {}): Response {
  const {
    status = 200,
    contentType = 'image/jpeg',
    bytes = 3149,
    headers = {},
  } = options;
  const allHeaders = new Headers({
    'Content-Type': contentType,
    'X-Conversion-Ms': '12.5',
    'X-Body-Bytes': String(bytes),
    'X-Server-Frame': '42',
    ...headers,
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: allHeaders,
    blob: vi.fn(async () => ({size: bytes, type: contentType}) as Blob),
  } as unknown as Response;
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

afterEach(() => {
  vi.useRealTimers();
});

describe('Esp32SnapshotController', () => {
  it('decodes a JPEG into the canvas and reports firmware diagnostics', async () => {
    const {canvas, drawImage} = createFakeCanvas();
    const bitmap = createBitmap();
    let clock = 100;
    const observed: {state?: Esp32SnapshotState} = {};
    const fetchFn = vi.fn(async (_input: string, _init?: RequestInit) => {
      clock += 214;
      return createJpegResponse({
        headers: {'X-Firmware-Build': 'camera_preview-2026-11-22-1s-5fps-v4'},
      });
    });
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(bitmap),
      createCanvas: () => canvas,
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => clock,
    });

    controller.subscribe((state) => {
      if (state.framesReceived === 1) {
        observed.state = state;
        controller.stop();
      }
    });

    await controller.connect('http://192.168.1.50');
    await vi.waitFor(() => expect(observed.state).toBeDefined());

    expect(fetchFn.mock.calls[0][0]).toContain('/capture_jpeg');
    expect(observed.state?.status).toBe('live');
    expect(observed.state?.error).toBeNull();
    expect(observed.state?.resolution).toEqual({width: 320, height: 240});
    expect(observed.state?.lastLatencyMs).toBe(214);
    expect(observed.state?.lastPayloadBytes).toBe(3149);
    expect(observed.state?.lastConversionMs).toBe(12.5);
    expect(observed.state?.lastServerFrame).toBe('42');
    expect(observed.state?.firmwareBuild).toBe(
      'camera_preview-2026-11-22-1s-5fps-v4',
    );
    expect(canvas.currentTime).toBe(1);
    expect(canvas.readyState).toBe(4);
    expect(canvas.videoWidth).toBe(320);
    expect(canvas.videoHeight).toBe(240);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('keeps one request in flight and ignores a stale response after reconnect', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: (AbortSignal | undefined)[] = [];
    const canvases: SnapshotFrameCanvas[] = [];
    const observed: {state?: Esp32SnapshotState} = {};
    const fetchFn = vi
      .fn((_input: string, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return canvases.length === 1 ? first.promise : second.promise;
      });
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(createBitmap()),
      createCanvas: () => {
        const {canvas} = createFakeCanvas();
        canvases.push(canvas);
        return canvas;
      },
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 100,
    });

    controller.subscribe((state) => {
      if (
        state.framesReceived === 1 &&
        state.captureUrl?.includes('192.168.1.51') === true
      ) {
        observed.state = state;
        controller.stop();
      }
    });

    await controller.connect('http://192.168.1.50/capture_jpeg');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await controller.connect('http://192.168.1.51/capture_jpeg');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    second.resolve(createJpegResponse());
    first.resolve(createJpegResponse());
    await vi.waitFor(() => expect(observed.state).toBeDefined());

    expect(observed.state?.captureUrl).toContain('192.168.1.51');
    expect(observed.state?.framesReceived).toBe(1);
    expect(canvases[0]?.currentTime).toBe(0);
    expect(canvases[1]?.currentTime).toBe(1);
  });

  it('backs off when firmware reports camera busy with HTTP 503', async () => {
    const waits: number[] = [];
    const observed: {state?: Esp32SnapshotState} = {};
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        createJpegResponse({status: 503, contentType: 'text/plain', bytes: 0}),
      )
      .mockResolvedValue(createJpegResponse());
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(createBitmap()),
      createCanvas: () => createFakeCanvas().canvas,
      wait: vi.fn(async (ms: number) => {
        waits.push(ms);
      }),
      now: () => 100,
    });

    controller.subscribe((state) => {
      if (state.framesReceived === 1) {
        observed.state = state;
        controller.stop();
      }
    });

    await controller.connect('http://192.168.1.50/capture_jpeg', 5);
    await vi.waitFor(() => expect(observed.state).toBeDefined());

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(waits[0]).toBeGreaterThanOrEqual(250);
    expect(waits[0]).toBeLessThanOrEqual(450);
    expect(observed.state?.error).toBeNull();
    expect(observed.state?.status).toBe('live');
  });

  it('treats an invalid JPEG as non-retryable but keeps the URL for Retry', async () => {
    const bitmap = createBitmap();
    const observed: {state?: Esp32SnapshotState} = {};
    const fetchFn = vi.fn().mockResolvedValue(createJpegResponse());
    const decodeJpeg = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid JPEG'))
      .mockResolvedValue(bitmap);
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: decodeJpeg,
      createCanvas: () => createFakeCanvas().canvas,
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 100,
    });

    controller.subscribe((state) => {
      if (state.error?.code === 'decode-failed' && observed.state === undefined) {
        observed.state = state;
      }
      if (state.framesReceived === 1) controller.stop();
    });

    await controller.connect('http://192.168.1.50/capture_jpeg');
    await vi.waitFor(() => expect(observed.state).toBeDefined());

    expect(observed.state?.status).toBe('error');
    expect(observed.state?.error?.code).toBe('decode-failed');
    expect(observed.state?.error?.retryable).toBe(false);

    await controller.retry();
    await vi.waitFor(() =>
      expect(controller.getState().error).toBeNull(),
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(controller.getState().error).toBeNull();
    expect(decodeJpeg).toHaveBeenCalledTimes(2);
  });

  it('rejects URLs with credentials and non-HTTP schemes without fetching', async () => {
    const fetchFn = vi.fn();
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(createBitmap()),
      createCanvas: () => createFakeCanvas().canvas,
      wait: vi.fn().mockResolvedValue(undefined),
    });

    await controller.connect('http://user:password@192.168.1.50/capture_jpeg');
    expect(controller.getState().error?.code).toBe('invalid-url');
    expect(controller.getState().error?.message).toContain('username or password');

    await controller.connect('ftp://192.168.1.50/capture_jpeg');
    expect(controller.getState().error?.code).toBe('invalid-url');

    await controller.connect('   ');
    expect(controller.getState().error?.code).toBe('invalid-url');

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('quiesces an in-flight poll for hardware alerts without stopping the camera', async () => {
    const first = deferred<Response>();
    const fetchFn = vi
      .fn((_input: string, _init?: RequestInit) =>
        fetchFn.mock.calls.length === 1 ? first.promise : Promise.resolve(createJpegResponse()),
      );
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(createBitmap()),
      createCanvas: () => createFakeCanvas().canvas,
      wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(1, ms))),
      now: () => 100,
    });
    controller.subscribe((state) => {
      if (state.framesReceived === 2) controller.stop();
    });

    await controller.connect('http://192.168.1.50/capture_jpeg');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const frameSource = controller.getState().frameSource;

    const quiesced = controller.quiesce();
    first.resolve(createJpegResponse());
    await quiesced;

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(controller.getState().frameSource).toBe(frameSource);
    expect(controller.getState().status).toBe('live');

    controller.resume();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.getState().status).toBe('idle'));
  });

  it('bounds a stalled request with a timeout', async () => {
    const observed: {state?: Esp32SnapshotState} = {};
    const fetchFn = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new Esp32SnapshotController({
      fetch: fetchFn,
      createBitmap: vi.fn().mockResolvedValue(createBitmap()),
      createCanvas: () => createFakeCanvas().canvas,
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 100,
      requestTimeoutMs: 20,
    });

    controller.subscribe((state) => {
      if (state.error?.code === 'network' && observed.state === undefined) {
        observed.state = state;
        controller.stop();
      }
    });

    await controller.connect('http://192.168.1.50/capture_jpeg');

    await vi.waitFor(() => {
      expect(observed.state?.error?.message).toContain('timed out');
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
