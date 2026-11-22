import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type {StatusTone} from '../types/dashboard';
import type {CameraResolution} from './deviceCameraController';
import {useDeviceCamera, type DeviceCameraApi} from './useDeviceCamera';

type ActiveStatus = 'idle' | 'requesting' | 'live' | 'error';

export interface CameraContextValue extends DeviceCameraApi {
  /** Monitoring always uses the existing local "This device" camera flow. */
  selectedCamera: 'this-device';
  /** Re-selecting stops the stream so a different USB/webcam can be chosen. */
  selectSource: (source: 'this-device') => void;
  activeStatus: ActiveStatus;
  activeStatusLabel: string;
  activeTone: StatusTone;
  activeResolution: CameraResolution | null;
  /** Stable identity for the selected video input + live stream. */
  activeCameraKey: string | null;
}

const CameraContext = createContext<CameraContextValue | null>(null);

export function CameraProvider({children}: {children: ReactNode}) {
  const selectedCamera = 'this-device' as const;
  const camera = useDeviceCamera();

  const selectSource = useCallback(
    (_source: 'this-device') => {
      // Stop only the device camera. The next explicit Start camera enumerates
      // inputs again so the user can pick an external USB camera.
      camera.stopCamera();
    },
    [camera.stopCamera],
  );

  const startCamera = useCallback(() => camera.startCamera(), [camera.startCamera]);
  const stopCamera = useCallback(() => camera.stopCamera(), [camera.stopCamera]);
  const retryCamera = useCallback(() => camera.retryCamera(), [camera.retryCamera]);

  const activeStatus: ActiveStatus = camera.state.status;
  const activeStatusLabel = camera.state.statusLabel;
  const activeTone: StatusTone = camera.state.tone;
  const activeResolution: CameraResolution | null = camera.state.resolution;
  // Camera identity depends on the selected video device and its live stream,
  // not on transient status, so a permission retry is not a camera change.
  const activeCameraKey: string | null =
    camera.state.stream !== null
      ? `device:${camera.state.selectedDeviceId ?? 'default'}:${camera.state.stream.id}`
      : null;

  const value = useMemo<CameraContextValue>(
    () => ({
      ...camera,
      selectedCamera,
      selectSource,
      activeStatus,
      activeStatusLabel,
      activeTone,
      activeResolution,
      activeCameraKey,
      startCamera,
      stopCamera,
      retryCamera,
    }),
    [
      camera,
      selectedCamera,
      selectSource,
      activeStatus,
      activeStatusLabel,
      activeTone,
      activeResolution,
      activeCameraKey,
      startCamera,
      stopCamera,
      retryCamera,
    ],
  );

  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useCamera(): CameraContextValue {
  const value = useContext(CameraContext);
  if (value === null) {
    throw new Error('useCamera must be used inside CameraProvider');
  }
  return value;
}
