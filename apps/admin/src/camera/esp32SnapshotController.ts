export type Esp32ConnectionStatus = 'idle' | 'requesting' | 'live' | 'error';
export type StatusTone = 'neutral' | 'teal' | 'amber' | 'red';

export type Esp32ErrorCode =
  | 'invalid-url'
  | 'unsupported'
  | 'network'
  | 'http-error'
  | 'camera-busy'
  | 'bad-content-type'
  | 'decode-failed'
  | 'unknown';

export interface Esp32Error {
  code: Esp32ErrorCode;
  message: string;
  retryable: boolean;
}

export interface CameraResolution {
  width: number;
  height: number;
}

/**
 * A canvas that also exposes the small metadata surface the existing tracker
 * reads from a video element. MediaPipe receives the canvas itself, which is a
 * valid image source; the metadata only drives dedupe, staleness, and sizing.
 */
export interface SnapshotFrameCanvas extends HTMLCanvasElement {
  currentTime: number;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}

export interface Esp32SnapshotState {
  status: Esp32ConnectionStatus;
  statusLabel: string;
  tone: StatusTone;
  error: Esp32Error | null;
  captureUrl: string | null;
  frameSource: SnapshotFrameCanvas | null;
  resolution: CameraResolution | null;
  framesReceived: number;
  lastLatencyMs: number | null;
  lastPayloadBytes: number | null;
  lastConversionMs: number | null;
  lastServerFrame: string | null;
  /** X-Firmware-Build from the current ESP32; null on older firmware. */
  firmwareBuild: string | null;
}

const IDLE_STATE: Esp32SnapshotState = {
  status: 'idle',
  statusLabel: 'Not connected',
  tone: 'neutral',
  error: null,
  captureUrl: null,
  frameSource: null,
  resolution: null,
  framesReceived: 0,
  lastLatencyMs: null,
  lastPayloadBytes: null,
  lastConversionMs: null,
  lastServerFrame: null,
  firmwareBuild: null,
};

const STATUS_LABELS: Record<Esp32ConnectionStatus, string> = {
  idle: 'Not connected',
  requesting: 'Connecting…',
  live: 'JPEG live',
  error: 'Connection error',
};

const STATUS_TONES: Record<Esp32ConnectionStatus, StatusTone> = {
  idle: 'neutral',
  requesting: 'amber',
  live: 'teal',
  error: 'red',
};

export interface DecodedJpegLike {
  width: number;
  height: number;
  close: () => void;
}

export interface Esp32SnapshotControllerOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  createBitmap?: (blob: Blob) => Promise<DecodedJpegLike>;
  createCanvas?: () => SnapshotFrameCanvas;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  requestTimeoutMs?: number;
}

function defaultCreateCanvas(): SnapshotFrameCanvas {
  const canvas = document.createElement('canvas') as SnapshotFrameCanvas;
  canvas.currentTime = 0;
  canvas.readyState = 0;
  canvas.videoWidth = 0;
  canvas.videoHeight = 0;
  return canvas;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function error(
  code: Esp32ErrorCode,
  message: string,
  retryable = true,
): Esp32Error {
  return {code, message, retryable};
}

function normalizeCaptureUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw error(
      'invalid-url',
      'Enter the ESP32 snapshot URL, for example http://192.168.1.50/capture_jpeg.',
      false,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(
      trimmed,
      typeof location === 'undefined' ? 'http://localhost/' : location.href,
    );
  } catch {
    throw error('invalid-url', 'The ESP32 snapshot URL is not valid.', false);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw error('invalid-url', 'Use an http:// or https:// snapshot URL.', false);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw error(
      'invalid-url',
      'Do not put a username or password in the ESP32 URL.',
      false,
    );
  }
  if (parsed.pathname === '' || parsed.pathname === '/') {
    parsed.pathname = '/capture_jpeg';
  }

  parsed.hash = '';
  return parsed.toString();
}

function withCacheBust(url: string, nonce: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set('_', `${Date.now()}-${nonce}`);
  return parsed.toString();
}

function readPositiveNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mapFetchError(cause: unknown): Esp32Error {
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return error('network', 'Snapshot request was cancelled.', true);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/aborted/i.test(message)) {
    return error(
      'network',
      'Snapshot request was cancelled. A new request will use the current camera source.',
      true,
    );
  }
  if (/failed to fetch|networkerror|load failed|timeout|network/i.test(message)) {
    return error(
      'network',
      'The ESP32 snapshot could not be reached. Check the address and local network.',
      true,
    );
  }
  return error('unknown', message || 'The ESP32 snapshot request failed.', true);
}

/**
 * Owns a single sequential snapshot loop. It never stores frames outside the
 * canvas and never starts a second request while one is in flight.
 */
export class Esp32SnapshotController {
  private state: Esp32SnapshotState = {...IDLE_STATE};
  private readonly listeners = new Set<(state: Esp32SnapshotState) => void>();
  private readonly fetchFn: NonNullable<Esp32SnapshotControllerOptions['fetch']>;
  private readonly createBitmap: NonNullable<Esp32SnapshotControllerOptions['createBitmap']>;
  private readonly createCanvas: NonNullable<Esp32SnapshotControllerOptions['createCanvas']>;
  private readonly wait: NonNullable<Esp32SnapshotControllerOptions['wait']>;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;

  private requestId = 0;
  private abortController: AbortController | null = null;
  private canvas: SnapshotFrameCanvas | null = null;
  private lastUrl: string | null = null;
  private lastFps = 5;
  private disposed = false;
  private running = false;
  /** Hardware alerts temporarily suspend new polls without aborting this loop. */
  private paused = false;
  private pauseDepth = 0;
  private requestActive = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: Esp32SnapshotControllerOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.createBitmap =
      options.createBitmap ??
      ((blob) => createImageBitmap(blob) as Promise<DecodedJpegLike>);
    this.createCanvas = options.createCanvas ?? defaultCreateCanvas;
    this.wait = options.wait ?? defaultWait;
    this.now = options.now ?? (() => performance.now());
    this.requestTimeoutMs = Math.max(
      100,
      options.requestTimeoutMs ?? 8000,
    );
  }

  getState(): Esp32SnapshotState {
    return this.state;
  }

  getFrameSource(): SnapshotFrameCanvas | null {
    return this.canvas;
  }

  subscribe(listener: (state: Esp32SnapshotState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  revive(): void {
    this.disposed = false;
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /**
   * Stops issuing new polls and resolves only after the in-flight request has
   * fully completed, so hardware commands never race an image body write on
   * the ESP32's single-threaded web server. It never aborts the snapshot loop.
   */
  async quiesce(): Promise<void> {
    if (!this.running || this.disposed) return;
    this.pauseDepth += 1;
    this.paused = true;
    if (!this.requestActive) {
      this.resolveIdleWaiters();
      return;
    }
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  resume(): void {
    // An aborted earlier alert can finish after a newer one has paused the
    // loop; only the last owner is allowed to resume polling.
    this.pauseDepth = Math.max(0, this.pauseDepth - 1);
    if (this.pauseDepth === 0) this.paused = false;
  }

  private resolveIdleWaiters(): void {
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  connect(rawUrl: string, fps = 5): Promise<void> {
    if (this.disposed) return Promise.resolve();

    let url: string;
    try {
      url = normalizeCaptureUrl(rawUrl);
    } catch (cause) {
      this.lastUrl = null;
      this.patch({
        ...IDLE_STATE,
        status: 'error',
        statusLabel: STATUS_LABELS.error,
        tone: STATUS_TONES.error,
        error: cause as Esp32Error,
      });
      return Promise.resolve();
    }

    const safeFps = Number.isFinite(fps) ? Math.min(10, Math.max(0.2, fps)) : 5;
    this.startLoop(url, safeFps);
    return Promise.resolve();
  }

  retry(): Promise<void> {
    if (this.lastUrl === null) return Promise.resolve();
    return this.connect(this.lastUrl, this.lastFps);
  }

  stop(): void {
    this.requestId += 1;
    this.running = false;
    this.paused = false;
    this.pauseDepth = 0;
    this.requestActive = false;
    this.resolveIdleWaiters();
    if (this.abortController !== null) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.canvas = null;
    this.lastUrl = null;
    this.patch({...IDLE_STATE});
  }

  /** Ends a failed loop while keeping the attempted URL available for Retry. */
  private failLoop(requestId: number, cause: Esp32Error): void {
    if (!this.isCurrent(requestId)) return;
    this.requestId += 1;
    this.running = false;
    this.paused = false;
    this.pauseDepth = 0;
    this.requestActive = false;
    this.resolveIdleWaiters();
    if (this.abortController !== null) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.canvas = null;
    this.patch({
      ...IDLE_STATE,
      status: 'error',
      statusLabel: STATUS_LABELS.error,
      tone: STATUS_TONES.error,
      error: cause,
    });
  }

  private startLoop(url: string, fps: number): void {
    this.requestId += 1;
    const requestId = this.requestId;
    this.running = true;
    this.paused = false;
    this.pauseDepth = 0;
    this.requestActive = false;
    this.resolveIdleWaiters();
    this.lastUrl = url;
    this.lastFps = fps;

    if (this.abortController !== null) this.abortController.abort();
    const controller = new AbortController();
    this.abortController = controller;

    this.canvas = this.createCanvas();
    this.patch({
      ...IDLE_STATE,
      status: 'requesting',
      statusLabel: STATUS_LABELS.requesting,
      tone: STATUS_TONES.requesting,
      captureUrl: url,
      frameSource: this.canvas,
    });

    void this.runLoop(requestId, url, fps, controller);
  }

  private isCurrent(requestId: number): boolean {
    return (
      !this.disposed &&
      this.running &&
      requestId === this.requestId &&
      this.abortController !== null
    );
  }

  private async runLoop(
    requestId: number,
    url: string,
    fps: number,
    controller: AbortController,
  ): Promise<void> {
    const intervalMs = 1000 / fps;
    let consecutiveFailures = 0;

    while (this.isCurrent(requestId)) {
      if (this.paused) {
        // No new poll while hardware commands are in flight. Re-checking with
        // a short wait keeps the loop alive without creating a request backlog.
        this.resolveIdleWaiters();
        await this.wait(20);
        continue;
      }

      this.requestActive = true;
      const startedAt = this.now();
      let bitmap: DecodedJpegLike | null = null;
      let timedOut = false;

      // One request-scoped signal per poll: a timeout ends only this request,
      // while Stop/connect ends the whole loop through the parent controller.
      const requestController = new AbortController();
      const forwardAbort = () => requestController.abort();
      controller.signal.addEventListener('abort', forwardAbort, {once: true});
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, this.requestTimeoutMs);

      try {
        const response = await this.fetchFn(withCacheBust(url, requestId), {
          cache: 'no-store',
          signal: requestController.signal,
        });
        if (!this.isCurrent(requestId)) return;

        if (response.status === 503) {
          throw error(
            'camera-busy',
            'The camera is busy with another capture; retrying.',
            true,
          );
        }
        if (!response.ok) {
          throw error(
            'http-error',
            `ESP32 returned HTTP ${response.status}. Use /capture_jpeg for JPEG snapshots.`,
            response.status >= 500,
          );
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('image/jpeg')) {
          throw error(
            'bad-content-type',
            'The ESP32 response was not image/jpeg. Use the /capture_jpeg endpoint.',
            false,
          );
        }

        const blob = await response.blob();
        if (!this.isCurrent(requestId)) return;

        try {
          bitmap = await this.createBitmap(blob);
        } catch {
          throw error(
            'decode-failed',
            'The ESP32 response was not a valid JPEG image.',
            false,
          );
        }
        if (!this.isCurrent(requestId)) {
          bitmap.close();
          return;
        }

        const canvas = this.canvas;
        if (canvas === null) {
          bitmap.close();
          return;
        }
        const context = canvas.getContext('2d');
        if (context === null) {
          throw error(
            'unsupported',
            'This browser could not create a 2D canvas for ESP32 frames.',
            false,
          );
        }

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        context.drawImage(bitmap as CanvasImageSource, 0, 0);
        canvas.currentTime += 1;
        canvas.readyState = 4;
        canvas.videoWidth = bitmap.width;
        canvas.videoHeight = bitmap.height;

        consecutiveFailures = 0;
        const latencyMs = Math.max(0, this.now() - startedAt);
        const conversionMs = readPositiveNumber(
          response.headers.get('X-Conversion-Ms'),
        );
        const bodyBytes = readPositiveNumber(response.headers.get('X-Body-Bytes'));

        this.patch({
          ...this.state,
          status: 'live',
          statusLabel: STATUS_LABELS.live,
          tone: STATUS_TONES.live,
          error: null,
          resolution: {width: bitmap.width, height: bitmap.height},
          framesReceived: this.state.framesReceived + 1,
          lastLatencyMs: latencyMs,
          lastPayloadBytes: bodyBytes ?? blob.size,
          lastConversionMs: conversionMs,
          lastServerFrame: response.headers.get('X-Server-Frame'),
          firmwareBuild: response.headers.get('X-Firmware-Build'),
        });
      } catch (cause) {
        if (!this.isCurrent(requestId)) return;
        const coded = cause as {
          code?: Esp32ErrorCode;
          message?: string;
          retryable?: boolean;
        };
        // Deliberate cancellation and a real timeout must not be conflated:
        // only a timeout is a connection problem worth reporting as failure.
        const mapped: Esp32Error = timedOut
          ? error(
              'network',
              'The ESP32 snapshot request timed out. Check the camera and local network.',
              true,
            )
          : requestController.signal.aborted
            ? error(
                'network',
                'Snapshot request was cancelled by a camera change; retrying with the current source.',
                true,
              )
            : coded.code !== undefined
              ? (cause as Esp32Error)
              : mapFetchError(cause);
        consecutiveFailures += 1;
        if (!mapped.retryable) {
          this.failLoop(requestId, mapped);
          return;
        }
        this.patch({
          ...this.state,
          status: this.state.framesReceived > 0 ? 'live' : 'requesting',
          statusLabel:
            this.state.framesReceived > 0 ? STATUS_LABELS.live : STATUS_LABELS.requesting,
          tone: this.state.framesReceived > 0 ? STATUS_TONES.live : STATUS_TONES.requesting,
          error: mapped,
        });
      } finally {
        clearTimeout(timeoutHandle);
        controller.signal.removeEventListener('abort', forwardAbort);
        bitmap?.close();
        this.requestActive = false;
        this.resolveIdleWaiters();
      }

      const elapsed = this.now() - startedAt;
      const backoff = consecutiveFailures > 0
        ? Math.min(2000, 250 * consecutiveFailures)
        : 0;
      await this.wait(Math.max(0, intervalMs - elapsed) + backoff);
    }
  }

  private patch(next: Esp32SnapshotState): void {
    this.state = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
