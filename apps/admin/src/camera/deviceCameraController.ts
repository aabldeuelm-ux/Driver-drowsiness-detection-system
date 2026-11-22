import type {StatusTone} from '../types/dashboard';

export type CameraConnectionStatus = 'idle' | 'requesting' | 'live' | 'error';

export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'constraint-unsupported'
  | 'device-lost'
  | 'unknown';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
  retryable: boolean;
}

export interface CameraResolution {
  width: number;
  height: number;
}

export interface DeviceCameraState {
  status: CameraConnectionStatus;
  statusLabel: string;
  tone: StatusTone;
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  resolution: CameraResolution | null;
  error: CameraError | null;
  secureContext: boolean;
  supported: boolean;
}

type StateListener = (state: DeviceCameraState) => void;

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: {ideal: 1280},
  height: {ideal: 720},
};

const ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  'insecure-context':
    'Camera preview requires a secure HTTPS context. Open the deployed app over HTTPS, then retry.',
  unsupported:
    'This browser does not expose camera access. Try a current version of Safari, Chrome, or Firefox.',
  'permission-denied':
    'Camera access was denied. Allow camera access for this site in your browser settings, then retry.',
  'no-camera':
    'No video input device was found. Connect a camera or webcam, then retry.',
  'camera-busy':
    'The camera is busy or could not be opened. Close other apps using it, then retry.',
  'constraint-unsupported':
    'The camera does not support the requested video settings. Retry with default settings.',
  'device-lost':
    'The selected camera disconnected. Reconnect it, then retry.',
  unknown:
    'The camera could not be started. Check the browser console, then retry.',
};

function createCameraError(code: CameraErrorCode): CameraError {
  return {
    code,
    message: ERROR_MESSAGES[code],
    retryable: code !== 'unsupported' && code !== 'insecure-context',
  };
}

function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaDevices ?? null;
}

function readEnvironment() {
  const secureContext =
    typeof window === 'undefined' || window.isSecureContext !== false;
  const mediaDevices = getMediaDevices();
  const supported =
    mediaDevices !== null && typeof mediaDevices.getUserMedia === 'function';
  return {secureContext, supported};
}

export function mapCameraError(error: unknown): CameraError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as {name?: unknown}).name)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return createCameraError('permission-denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return createCameraError('no-camera');
    case 'NotReadableError':
    case 'TrackStartError':
      return createCameraError('camera-busy');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return createCameraError('constraint-unsupported');
    case 'AbortError':
      return createCameraError('unknown');
    default:
      return createCameraError('unknown');
  }
}

function resolutionFromTrack(
  track: MediaStreamTrack | undefined,
): CameraResolution | null {
  const settings = track?.getSettings?.();
  if (!settings) return null;
  if (typeof settings.width !== 'number' || typeof settings.height !== 'number') {
    return null;
  }
  return {width: settings.width, height: settings.height};
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Owns the MediaStream lifecycle. This class deliberately has no React or
 * rendering dependencies so cleanup and cancellation can be tested directly.
 */
export class DeviceCameraController {
  private state: DeviceCameraState;
  private readonly listeners = new Set<StateListener>();
  private readonly videoConstraints: MediaTrackConstraints;
  private stream: MediaStream | null = null;
  private requestId = 0;
  private disposed = false;
  private lastRequestedDeviceId: string | null = null;
  private trackCleanup: Array<() => void> = [];
  private deviceChangeListenerAttached = false;

  constructor(videoConstraints: MediaTrackConstraints = DEFAULT_VIDEO_CONSTRAINTS) {
    this.videoConstraints = videoConstraints;
    const environment = readEnvironment();

    if (!environment.secureContext) {
      this.state = {
        status: 'error',
        statusLabel: 'Insecure context',
        tone: 'red',
        stream: null,
        devices: [],
        selectedDeviceId: null,
        resolution: null,
        error: createCameraError('insecure-context'),
        ...environment,
      };
      return;
    }

    if (!environment.supported) {
      this.state = {
        status: 'error',
        statusLabel: 'Camera unsupported',
        tone: 'red',
        stream: null,
        devices: [],
        selectedDeviceId: null,
        resolution: null,
        error: createCameraError('unsupported'),
        ...environment,
      };
      return;
    }

    this.state = {
      status: 'idle',
      statusLabel: 'Camera stopped',
      tone: 'neutral',
      stream: null,
      devices: [],
      selectedDeviceId: null,
      resolution: null,
      error: null,
      ...environment,
    };
  }

  getState(): DeviceCameraState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-attach global listeners after a Strict Mode simulated remount. */
  revive(): void {
    this.disposed = false;
    this.attachDeviceChangeListener();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.detachDeviceChangeListener();
  }

  async start(deviceId: string | null = null): Promise<void> {
    if (this.disposed) return;

    const requestId = ++this.requestId;
    this.lastRequestedDeviceId = deviceId;
    this.stopCurrentStream();

    this.patch({
      status: 'requesting',
      statusLabel: 'Camera requesting',
      tone: 'amber',
      stream: null,
      resolution: null,
      error: null,
      selectedDeviceId: deviceId ?? this.state.selectedDeviceId,
    });

    const environment = readEnvironment();
    if (!environment.secureContext) {
      this.fail(requestId, createCameraError('insecure-context'));
      return;
    }

    const mediaDevices = getMediaDevices();
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      this.fail(requestId, createCameraError('unsupported'));
      return;
    }

    try {
      const video: MediaTrackConstraints = deviceId
        ? {...this.videoConstraints, deviceId: {exact: deviceId}}
        : this.videoConstraints;

      const stream = await mediaDevices.getUserMedia({video, audio: false});

      if (this.isStale(requestId)) {
        stopStream(stream);
        return;
      }

      this.stream = stream;
      this.attachTrackListeners(stream);

      const videoTrack = stream.getVideoTracks()[0];
      const activeDeviceId = videoTrack?.getSettings?.().deviceId ?? deviceId ?? null;

      this.patch({
        status: 'live',
        statusLabel: 'Camera live',
        tone: 'teal',
        stream,
        resolution: resolutionFromTrack(videoTrack),
        selectedDeviceId: activeDeviceId,
        error: null,
      });

      await this.refreshDevices(requestId, false);
    } catch (error) {
      this.fail(requestId, mapCameraError(error));
    }
  }

  async selectDevice(deviceId: string): Promise<void> {
    await this.start(deviceId);
  }

  retry(): Promise<void> {
    return this.start(this.lastRequestedDeviceId);
  }

  stop(): void {
    this.requestId += 1;
    this.stopCurrentStream();
    this.patch({
      status: 'idle',
      statusLabel: 'Camera stopped',
      tone: 'neutral',
      stream: null,
      resolution: null,
      error: null,
    });
  }

  private isStale(requestId: number): boolean {
    return this.disposed || requestId !== this.requestId;
  }

  private patch(partial: Partial<DeviceCameraState>): void {
    this.state = {...this.state, ...partial};
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private fail(requestId: number, error: CameraError): void {
    if (this.isStale(requestId)) return;
    this.stopCurrentStream();
    this.patch({
      status: 'error',
      statusLabel: 'Camera error',
      tone: 'red',
      stream: null,
      resolution: null,
      error,
    });
  }

  private stopCurrentStream(): void {
    for (const cleanup of this.trackCleanup) {
      cleanup();
    }
    this.trackCleanup = [];
    stopStream(this.stream);
    this.stream = null;
  }

  private attachTrackListeners(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const handleEnded = () => {
      if (!this.stream || this.isStale(this.requestId)) return;
      this.stopWithError('device-lost');
    };

    track.addEventListener('ended', handleEnded);
    this.trackCleanup.push(() => track.removeEventListener('ended', handleEnded));
  }

  private stopWithError(code: CameraErrorCode): void {
    this.requestId += 1;
    this.stopCurrentStream();
    this.patch({
      status: 'error',
      statusLabel: 'Camera error',
      tone: 'red',
      stream: null,
      resolution: null,
      error: createCameraError(code),
    });
  }

  private attachDeviceChangeListener(): void {
    if (this.deviceChangeListenerAttached) return;
    const mediaDevices = getMediaDevices();
    if (!mediaDevices || typeof mediaDevices.addEventListener !== 'function') return;
    mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
    this.deviceChangeListenerAttached = true;
  }

  private detachDeviceChangeListener(): void {
    if (!this.deviceChangeListenerAttached) return;
    const mediaDevices = getMediaDevices();
    if (mediaDevices && typeof mediaDevices.removeEventListener === 'function') {
      mediaDevices.removeEventListener('devicechange', this.handleDeviceChange);
    }
    this.deviceChangeListenerAttached = false;
  }

  private handleDeviceChange = (): void => {
    if (!this.stream) return;
    void this.refreshDevices(this.requestId, true);
  };

  private async refreshDevices(
    requestId: number,
    checkActiveDevice: boolean,
  ): Promise<void> {
    const mediaDevices = getMediaDevices();
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return;

    try {
      const devices = (await mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'videoinput',
      );

      if (this.isStale(requestId)) return;
      this.patch({devices});

      if (!checkActiveDevice) return;

      const activeDeviceId =
        this.stream?.getVideoTracks()[0]?.getSettings?.().deviceId ??
        this.state.selectedDeviceId;

      if (
        activeDeviceId &&
        !devices.some((device) => device.deviceId === activeDeviceId)
      ) {
        this.stopWithError('device-lost');
      }
    } catch {
      // Device enumeration is informational; streaming can continue without it.
    }
  }
}
