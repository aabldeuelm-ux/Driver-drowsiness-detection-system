import {useEffect, useRef} from 'react';

interface DeviceCameraVideoProps {
  stream: MediaStream;
  className?: string;
  mirrored?: boolean;
  onVideoElement?: (video: HTMLVideoElement | null) => void;
}

/** Presentational only: attaches the supplied stream to a muted inline video element. */
export function DeviceCameraVideo({
  stream,
  className = '',
  mirrored = false,
  onVideoElement,
}: DeviceCameraVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;
    video.srcObject = stream;

    void video.play().catch(() => {
      // Autoplay can still be blocked by the browser. The stream remains attached.
    });

    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    onVideoElement?.(videoRef.current);
    return () => onVideoElement?.(null);
  }, [onVideoElement]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={className}
      style={mirrored ? {transform: 'scaleX(-1)'} : undefined}
      aria-label="Live device camera preview"
    />
  );
}
