"""MediaPipe pose detection. The only module here that imports MediaPipe."""

import threading
from pathlib import Path
from typing import Protocol

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

from app.estimation.types import BodyScan, Landmark, Point, RGBImage

MASK_THRESHOLD = 0.5


class PoseDetector(Protocol):
    def detect(self, image: RGBImage) -> BodyScan | None:
        """Return the single detected person, or None if there is nobody."""
        ...


class MediaPipeDetector:
    """Thread-safe: each worker thread lazily gets its own landmarker instance."""

    def __init__(self, model_path: Path) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Pose model not found at {model_path}. "
                "Run `uv run python -m scripts.download_models` in apps/api."
            )
        self._model_path = model_path
        self._local = threading.local()
        self._created: list[PoseLandmarker] = []
        self._lock = threading.Lock()

    def _landmarker(self) -> PoseLandmarker:
        landmarker: PoseLandmarker | None = getattr(self._local, "landmarker", None)
        if landmarker is None:
            options = PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(self._model_path)),
                running_mode=RunningMode.IMAGE,
                num_poses=2,  # detect a second person so we can ask for a solo photo
                output_segmentation_masks=True,
            )
            landmarker = PoseLandmarker.create_from_options(options)
            self._local.landmarker = landmarker
            with self._lock:
                self._created.append(landmarker)
        return landmarker

    def close(self) -> None:
        """Release native resources. Call on shutdown, before the interpreter exits."""
        with self._lock:
            for landmarker in self._created:
                landmarker.close()
            self._created.clear()

    def detect(self, image: RGBImage) -> BodyScan | None:
        height, width = image.shape[:2]
        result = self._landmarker().detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image))
        )
        if not result.pose_landmarks:
            return None
        if len(result.pose_landmarks) > 1:
            raise MultiplePeopleError
        raw = result.pose_landmarks[0]
        landmarks = {
            lm: Point(
                x=float(raw[lm].x) * width,
                y=float(raw[lm].y) * height,
                visibility=float(raw[lm].visibility or 0.0),
            )
            for lm in Landmark
        }
        masks = result.segmentation_masks or []
        if not masks:
            return None
        mask = np.asarray(masks[0].numpy_view()).reshape(height, width) > MASK_THRESHOLD
        return BodyScan(landmarks=landmarks, mask=mask)


class MultiplePeopleError(Exception):
    pass
