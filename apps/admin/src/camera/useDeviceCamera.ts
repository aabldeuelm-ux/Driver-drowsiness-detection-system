import {useCallback, useEffect, useRef, useState} from 'react';
import {
  DeviceCameraController,
  type DeviceCameraState,
} from './deviceCameraController';

export interface DeviceCameraApi {
  state: DeviceCameraState;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  selectDevice: (deviceId: string) => Promise<void>;
  retryCamera: () => Promise<void>;
}

export function useDeviceCamera(): DeviceCameraApi {
  const controllerRef = useRef<DeviceCameraController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new DeviceCameraController();
  }

  const controller = controllerRef.current;
  const [state, setState] = useState<DeviceCameraState>(() => controller.getState());

  useEffect(() => {
    controller.revive();
    setState(controller.getState());

    const unsubscribe = controller.subscribe(setState);

    const handlePageHide = () => {
      controller.stop();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', handlePageHide);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide);
      }
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const startCamera = useCallback(() => controller.start(), [controller]);
  const stopCamera = useCallback(() => controller.stop(), [controller]);
  const selectDevice = useCallback(
    (deviceId: string) => controller.selectDevice(deviceId),
    [controller],
  );
  const retryCamera = useCallback(() => controller.retry(), [controller]);

  return {state, startCamera, stopCamera, selectDevice, retryCamera};
}
