"""Photo -> measurement estimates.

Photos only ever exist in memory: they are decoded to pixels (which drops EXIF and every
other piece of metadata), measured, and discarded. Nothing is written to disk or logged.
"""

import asyncio
import io
import logging
from collections.abc import Awaitable, Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.estimation import MediaPipeDetector, PoseDetector, RetakeError, RGBImage, estimate
from app.schemas import MEASUREMENT_RANGES, Measurements, PhotoEstimate
from app.services.profile_photos import PhotoKind

# Called with the decoded photos after a successful estimate, when the user opted to keep them.
KeepPhotos = Callable[[Sequence[tuple[PhotoKind, RGBImage]]], Awaitable[list[UUID]]]

logger = logging.getLogger(__name__)

ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}  # MPO: multi-picture JPEGs from phones
MAX_PIXELS = 40_000_000  # decompression-bomb guard, checked before decoding
MIN_SHORT_SIDE, MIN_LONG_SIDE = 128, 256  # MediaPipe pose works at 256 px
WORKING_LONG_SIDE = 1920  # larger photos are downscaled before detection

# Estimation is CPU-bound; a small dedicated pool keeps the event loop and DB pool free.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="estimation")


class PhotoError(Exception):
    """The upload is not a usable image. `message` is safe to show to the user."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


_detectors: dict[str, MediaPipeDetector] = {}


def get_detector(model_path: str) -> MediaPipeDetector:
    if model_path not in _detectors:
        _detectors[model_path] = MediaPipeDetector(Path(model_path))
    return _detectors[model_path]


def shutdown() -> None:
    """Stop the worker pool and free MediaPipe's native resources (app shutdown)."""
    _executor.shutdown(wait=True)
    for detector in _detectors.values():
        detector.close()
    _detectors.clear()


def decode_photo(data: bytes, which: str) -> RGBImage:
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format not in ALLOWED_FORMATS:
                raise PhotoError(415, "unsupported_type", "Use a JPEG, PNG or WebP photo.")
            width, height = img.size
            if width * height > MAX_PIXELS:
                raise PhotoError(
                    422, "photo_too_big", f"The {which} photo's resolution is too high."
                )
            img.load()
            upright = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise PhotoError(422, "unreadable_photo", f"We couldn't read the {which} photo.") from exc

    short, long = sorted(upright.size)
    if short < MIN_SHORT_SIDE or long < MIN_LONG_SIDE:
        raise PhotoError(
            422, "photo_too_small", f"The {which} photo is too small. Use a sharper photo."
        )
    upright.thumbnail((WORKING_LONG_SIDE, WORKING_LONG_SIDE), Image.Resampling.LANCZOS)
    return np.asarray(upright, dtype=np.uint8)


def _to_response(
    height_cm: float, values: dict[str, float], confidence: dict[str, float], notes: list[str]
) -> PhotoEstimate:
    # Drop anything outside the accepted ranges rather than return a value that can't be saved.
    kept = {
        field: value
        for field, value in values.items()
        if field in MEASUREMENT_RANGES
        and MEASUREMENT_RANGES[field][0] <= value <= MEASUREMENT_RANGES[field][1]
    }
    return PhotoEstimate(
        measurements=Measurements(height_cm=height_cm, **kept),
        confidence={field: confidence[field] for field in kept},
        notes=notes,
    )


async def estimate_from_photos(
    detector: PoseDetector,
    front: bytes,
    side: bytes | None,
    height_cm: float,
    keep: KeepPhotos | None = None,
) -> PhotoEstimate:
    """Raises PhotoError (bad upload) or RetakeError (photo can't be measured).

    Photos are kept only if `keep` is given (the user opted in) and the estimate succeeded.
    """
    front_pixels = decode_photo(front, "front")
    side_pixels = decode_photo(side, "side") if side is not None else None
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            _executor, estimate, detector, front_pixels, side_pixels, height_cm
        )
        response = _to_response(height_cm, result.values, result.confidence, result.notes)
        if keep is not None:
            photos: list[tuple[PhotoKind, RGBImage]] = [("front", front_pixels)]
            if side_pixels is not None:
                photos.append(("side", side_pixels))
            response.kept_photo_ids = await keep(photos)
    except RetakeError as exc:
        logger.info("Photo estimate needs a retake: %s", exc.code)
        raise
    finally:
        del front_pixels, side_pixels
    logger.info("Photo estimate completed (%d fields)", len(result.values))
    return response
