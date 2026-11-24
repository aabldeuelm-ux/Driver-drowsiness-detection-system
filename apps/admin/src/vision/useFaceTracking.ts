import {useCallback, useEffect, useRef, useState} from 'react';
import {
  FaceTrackingController,
  type FaceTrackingState,
  type TrackingFrameSource,
} from './faceTrackingController';

export interface FaceTrackingApi {
  state: FaceTrackingState;
  startTracking: (source: TrackingFrameSource) => Promise<void>;
  stopTracking: () => void;
  retryTracking: () => Promise<void>;
  startCalibration: () => void;
  selectFace: (faceId: number) => void;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  invalidateCalibration: (
    reason: 'camera-changed' | 'resolution-changed',
  ) => void;
  /** Experimental setting in milliseconds; in memory only. */
  prolongedClosureMs: number;
  setProlongedClosureMs: (value: number) => void;
}

export function useFaceTracking(): FaceTrackingApi {
  const controllerRef = useRef<FaceTrackingController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new FaceTrackingController();
  }
  const controller = controllerRef.current;
  const [state, setState] = useState<FaceTrackingState>(() => controller.getState());

  useEffect(() => {
    controller.revive();
    setState(controller.getState());

    const unsubscribe = controller.subscribe(setState);

    const handleVisibility = () => {
      controller.setPageVisible(document.visibilityState !== 'hidden');
    };
    const handlePageHide = () => {
      controller.stopSession();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const startTracking = useCallback(
    (source: TrackingFrameSource) => controller.start(source),
    [controller],
  );
  const stopTracking = useCallback(() => controller.stopSession(), [controller]);
  const retryTracking = useCallback(() => controller.retry(), [controller]);
  const startCalibration = useCallback(
    () => controller.startCalibration(),
    [controller],
  );
  const selectFace = useCallback(
    (faceId: number) => controller.selectFace(faceId),
    [controller],
  );
  const startMonitoring = useCallback(
    () => controller.startMonitoring(),
    [controller],
  );
  const stopMonitoring = useCallback(
    () => controller.stopMonitoring(),
    [controller],
  );
  const invalidateCalibration = useCallback(
    (reason: 'camera-changed' | 'resolution-changed') =>
      controller.invalidateCalibration(reason),
    [controller],
  );
  const setProlongedClosureMs = useCallback(
    (value: number) => controller.setProlongedClosureMs(value),
    [controller],
  );

  return {
    state,
    startTracking,
    stopTracking,
    retryTracking,
    startCalibration,
    selectFace,
    startMonitoring,
    stopMonitoring,
    invalidateCalibration,
    prolongedClosureMs: state.prolongedClosureMs,
    setProlongedClosureMs,
  };
}
