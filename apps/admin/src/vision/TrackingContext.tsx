import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {useCamera} from '../camera/CameraContext';
import {useFaceTracking, type FaceTrackingApi} from './useFaceTracking';

const TrackingContext = createContext<FaceTrackingApi | null>(null);

interface CameraBinding {
  status: string;
  key: string | null;
}

export function TrackingProvider({children}: {children: ReactNode}) {
  const tracking = useFaceTracking();
  const camera = useCamera();
  const previousCamera = useRef<CameraBinding | null>(null);

  useEffect(() => {
    const current: CameraBinding = {
      status: camera.activeStatus,
      key: camera.activeCameraKey,
    };
    const previous = previousCamera.current;
    previousCamera.current = current;

    if (!previous) return;

    const cameraChanged = previous.key !== current.key;
    if (cameraChanged) {
      tracking.invalidateCalibration('camera-changed');
    }
    if (current.status !== 'live' || current.key === null || cameraChanged) {
      tracking.stopTracking();
    }
  }, [
    camera.activeStatus,
    camera.activeCameraKey,
    tracking.invalidateCalibration,
    tracking.stopTracking,
  ]);

  return <TrackingContext.Provider value={tracking}>{children}</TrackingContext.Provider>;
}

export function useTracking(): FaceTrackingApi {
  const value = useContext(TrackingContext);
  if (!value) {
    throw new Error('useTracking must be used inside TrackingProvider');
  }
  return value;
}
