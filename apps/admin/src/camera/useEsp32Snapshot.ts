import {useCallback, useEffect, useRef, useState} from 'react';
import {
  Esp32SnapshotController,
  type Esp32SnapshotState,
} from './esp32SnapshotController';

export interface Esp32SnapshotApi {
  state: Esp32SnapshotState;
  connect: (url: string, fps?: number) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>;
  /** Pauses polling for a hardware command and resumes it afterward. */
  quiesce: () => Promise<void>;
  resume: () => void;
}

export function useEsp32Snapshot(): Esp32SnapshotApi {
  const controllerRef = useRef<Esp32SnapshotController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new Esp32SnapshotController();
  }
  const controller = controllerRef.current;
  const [state, setState] = useState<Esp32SnapshotState>(() => controller.getState());

  useEffect(() => {
    controller.revive();
    setState(controller.getState());

    const unsubscribe = controller.subscribe(setState);
    const handlePageHide = () => controller.stop();

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

  const connect = useCallback(
    (url: string, fps?: number) => controller.connect(url, fps),
    [controller],
  );
  const stop = useCallback(() => controller.stop(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const quiesce = useCallback(() => controller.quiesce(), [controller]);
  const resume = useCallback(() => controller.resume(), [controller]);

  return {state, connect, stop, retry, quiesce, resume};
}
