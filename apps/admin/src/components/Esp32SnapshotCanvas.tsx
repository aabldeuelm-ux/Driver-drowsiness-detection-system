import {useEffect, useRef} from 'react';
import type {SnapshotFrameCanvas} from '../camera/esp32SnapshotController';

interface Esp32SnapshotCanvasProps {
  frameSource: SnapshotFrameCanvas;
  className?: string;
  mirrored?: boolean;
  onFrameElement?: (canvas: SnapshotFrameCanvas | null) => void;
}

/** Attaches the controller-owned canvas to the preview without copying frames. */
export function Esp32SnapshotCanvas({
  frameSource,
  className = '',
  mirrored = false,
  onFrameElement,
}: Esp32SnapshotCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    frameSource.className = className;
    frameSource.style.transform = mirrored ? 'scaleX(-1)' : '';
    frameSource.style.objectFit = 'cover';
    frameSource.setAttribute('aria-label', 'Live ESP32 JPEG snapshot preview');
    container.replaceChildren(frameSource);

    return () => {
      frameSource.remove();
    };
  }, [frameSource, className, mirrored]);

  useEffect(() => {
    onFrameElement?.(frameSource);
    return () => onFrameElement?.(null);
  }, [frameSource, onFrameElement]);

  return <div ref={containerRef} className="absolute inset-0 bg-black" />;
}
