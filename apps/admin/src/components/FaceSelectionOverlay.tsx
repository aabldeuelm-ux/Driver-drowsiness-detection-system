import {useEffect, useRef, useState} from 'react';
import type {FaceCandidate, VideoSize} from '../vision/faceTrackingController';
import {mapNormalizedPoint, type PreviewSize} from './previewGeometry';

interface FaceSelectionOverlayProps {
  candidates: readonly FaceCandidate[];
  videoSize: VideoSize | null;
  mirrored: boolean;
  onSelect: (faceId: number) => void;
}

export function FaceSelectionOverlay({
  candidates,
  videoSize,
  mirrored,
  onSelect,
}: FaceSelectionOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PreviewSize>({width: 0, height: 0});

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({width: rect.width, height: rect.height});
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (candidates.length === 0 || !videoSize || size.width === 0) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      {candidates.map((candidate) => {
        const topLeft = mapNormalizedPoint(
          {x: candidate.box.x, y: candidate.box.y},
          size,
          videoSize,
          mirrored,
        );
        const bottomRight = mapNormalizedPoint(
          {
            x: candidate.box.x + candidate.box.width,
            y: candidate.box.y + candidate.box.height,
          },
          size,
          videoSize,
          mirrored,
        );
        const left = Math.min(topLeft.x, bottomRight.x);
        const top = Math.min(topLeft.y, bottomRight.y);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        return (
          <div key={candidate.id}>
            <div
              aria-hidden="true"
              className={`absolute rounded-lg border-2 ${
                candidate.selected
                  ? 'border-teal-300 bg-teal-400/5'
                  : candidate.ambiguous
                    ? 'border-amber-300 bg-amber-400/5'
                    : 'border-slate-200/70 bg-slate-200/5'
              }`}
              style={{left, top, width, height}}
            />
            <button
              type="button"
              onClick={() => onSelect(candidate.id)}
              aria-label={`Select face ${candidate.number}${candidate.selected ? ', currently selected' : ''}`}
              aria-pressed={candidate.selected}
              className={`pointer-events-auto absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-sm font-semibold shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                candidate.selected
                  ? 'border-teal-200 bg-teal-500 text-slate-950'
                  : candidate.ambiguous
                    ? 'border-amber-200 bg-amber-500 text-slate-950'
                    : 'border-slate-200 bg-slate-900/90 text-slate-100 hover:bg-slate-700'
              }`}
              style={{left: centerX, top: centerY}}
            >
              {candidate.number}
            </button>
          </div>
        );
      })}
    </div>
  );
}
