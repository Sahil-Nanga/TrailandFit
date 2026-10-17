"""Plain data passed between the detector, validation and measurement steps."""

from dataclasses import dataclass, field
from enum import IntEnum

import numpy as np
from numpy.typing import NDArray

RGBImage = NDArray[np.uint8]  # H x W x 3
Mask = NDArray[np.bool_]  # H x W, True where the person is


class Landmark(IntEnum):
    """BlazePose landmark indices used here (33-point model)."""

    NOSE = 0
    LEFT_EAR = 7
    RIGHT_EAR = 8
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30


@dataclass(frozen=True, slots=True)
class Point:
    x: float  # pixels from the left
    y: float  # pixels from the top
    visibility: float  # 0..1


@dataclass(frozen=True, slots=True)
class BodyScan:
    """One detected person: landmarks in pixel coordinates plus a silhouette mask."""

    landmarks: dict[Landmark, Point]
    mask: Mask

    @property
    def height_px(self) -> int:
        return int(self.mask.shape[0])

    @property
    def width_px(self) -> int:
        return int(self.mask.shape[1])

    def point(self, landmark: Landmark) -> Point:
        return self.landmarks[landmark]


@dataclass(frozen=True, slots=True)
class Estimate:
    """Measurements in cm (None when not estimated) and a 0..1 confidence for each."""

    values: dict[str, float]
    confidence: dict[str, float]
    notes: list[str] = field(default_factory=list)


class RetakeError(Exception):
    """The photo cannot be measured. `message` is safe to show to the user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
