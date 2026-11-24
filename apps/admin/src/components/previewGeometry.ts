import type {LandmarkPoint} from '../vision/earGeometry';
import type {VideoSize} from '../vision/faceTrackingController';

export interface PreviewSize {
  width: number;
  height: number;
}

/** Maps a normalized video point through the preview's object-cover crop. */
export function mapNormalizedPoint(
  point: LandmarkPoint,
  canvasSize: PreviewSize,
  videoSize: VideoSize,
  mirrored: boolean,
): LandmarkPoint {
  const scale = Math.max(
    canvasSize.width / videoSize.width,
    canvasSize.height / videoSize.height,
  );
  const drawnWidth = videoSize.width * scale;
  const drawnHeight = videoSize.height * scale;
  const offsetX = (canvasSize.width - drawnWidth) / 2;
  const offsetY = (canvasSize.height - drawnHeight) / 2;

  const x = offsetX + point.x * drawnWidth;
  const y = offsetY + point.y * drawnHeight;
  return {x: mirrored ? canvasSize.width - x : x, y};
}
