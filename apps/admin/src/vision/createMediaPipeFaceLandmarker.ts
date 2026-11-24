import type {
  FaceLandmarker,
  FaceLandmarkerOptions,
  ImageSource,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type {FaceLandmarkerLike} from './faceTrackingController';
import {
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_BASE_URL,
} from './mediapipeAssets';

/**
 * Creates the real MediaPipe Face Landmarker. Dynamic import keeps the WASM
 * glue out of the initial bundle; the model/WASM files are fetched only when
 * Start tracking is clicked.
 */
export async function createMediaPipeFaceLandmarker(): Promise<FaceLandmarkerLike> {
  const {FaceLandmarker, FilesetResolver} = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);

  const options = (delegate: 'GPU' | 'CPU'): FaceLandmarkerOptions => ({
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      delegate,
    },
    runningMode: 'VIDEO',
    // Several faces are returned so the user can select one spatially; only
    // the selected face is ever used for measurements and alerts.
    numFaces: 4,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
  });

  try {
    const landmarker = await FaceLandmarker.createFromOptions(
      vision,
      options('GPU'),
    );
    return toControllerLandmarker(landmarker);
  } catch (gpuError) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(
        vision,
        options('CPU'),
      );
      return toControllerLandmarker(landmarker);
    } catch {
      throw gpuError;
    }
  }
}

function toControllerLandmarker(landmarker: FaceLandmarker): FaceLandmarkerLike {
  return {
    detectForVideo(video, timestamp) {
      const result = landmarker.detectForVideo(video as ImageSource, timestamp);
      return {
        faceLandmarks: result.faceLandmarks as readonly (readonly NormalizedLandmark[])[],
      };
    },
    close() {
      landmarker.close();
    },
  };
}
