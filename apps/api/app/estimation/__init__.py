"""Photo -> body measurements.

Isolated on purpose: no web, database or app-settings imports, so it can move into its own
service later. Input is decoded RGB pixels plus the user's height; output is measurements in
cm with a confidence per value, or a RetakeError explaining what to fix.
"""

from app.estimation.detector import MediaPipeDetector, MultiplePeopleError, PoseDetector
from app.estimation.measure import measure
from app.estimation.types import BodyScan, Estimate, RetakeError, RGBImage
from app.estimation.validate import validate_front, validate_side

__all__ = [
    "BodyScan",
    "Estimate",
    "MediaPipeDetector",
    "PoseDetector",
    "RGBImage",
    "RetakeError",
    "estimate",
]


def _scan(detector: PoseDetector, image: RGBImage, which: str) -> BodyScan:
    try:
        scan = detector.detect(image)
    except MultiplePeopleError as exc:
        raise RetakeError(
            "multiple_people", f"Make sure you're the only person in the {which} photo."
        ) from exc
    if scan is None:
        raise RetakeError(
            "no_person",
            f"We couldn't find a person in the {which} photo. Use a well-lit, full-body photo.",
        )
    return scan


def estimate(
    detector: PoseDetector, front: RGBImage, side: RGBImage | None, height_cm: float
) -> Estimate:
    """CPU-heavy and blocking: call it from a worker thread, not the event loop."""
    front_scan = _scan(detector, front, "front")
    validate_front(front_scan)
    side_scan = None
    if side is not None:
        side_scan = _scan(detector, side, "side")
        validate_side(side_scan)
    return measure(front_scan, side_scan, height_cm)
