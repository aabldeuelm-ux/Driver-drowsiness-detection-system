import {useEffect, useRef, useState} from 'react';
import {EYE_OUTLINES, type LandmarkPoint} from '../vision/earGeometry';
import type {VideoSize} from '../vision/faceTrackingController';
import {mapNormalizedPoint, type PreviewSize} from './previewGeometry';

interface EyeLandmarkOverlayProps {
  landmarks: readonly LandmarkPoint[] | null;
  videoSize: VideoSize | null;
  mirrored: boolean;
  visible: boolean;
}

type CanvasSize = PreviewSize;

/** Presentation-only canvas overlay; it never stores video frames. */
export function EyeLandmarkOverlay({
  landmarks,
  videoSize,
  mirrored,
  visible,
}: EyeLandmarkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({width: 0, height: 0});

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const update = () => {
      const rect = parent.getBoundingClientRect();
      setCanvasSize({width: rect.width, height: rect.height});
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvasSize.width * ratio));
    canvas.height = Math.max(1, Math.round(canvasSize.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (!visible || !landmarks || !videoSize || canvasSize.width === 0) return;

    context.strokeStyle = 'rgba(45, 212, 191, 0.95)';
    context.fillStyle = 'rgba(240, 253, 250, 0.95)';
    context.lineWidth = 2;

    for (const outline of EYE_OUTLINES) {
      const points = outline
        .map((index) => landmarks[index])
        .filter((point): point is LandmarkPoint => Boolean(point))
        .map((point) => mapNormalizedPoint(point, canvasSize, videoSize, mirrored));

      if (points.length < 2) continue;

      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.closePath();
      context.stroke();

      for (const point of points) {
        context.beginPath();
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [canvasSize, landmarks, mirrored, videoSize, visible]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
