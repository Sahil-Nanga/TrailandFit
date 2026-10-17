from collections.abc import Sequence
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import OptionalPhotoStore
from app.core.config import Settings, get_settings
from app.core.errors import AppError, ErrorResponse
from app.core.limits import RateLimiter
from app.core.security import CurrentUserDep
from app.db.session import SessionDep
from app.estimation import PoseDetector, RetakeError, RGBImage
from app.schemas import MEASUREMENT_RANGES, PhotoEstimate
from app.services import photos as service
from app.services import profile_photos

router = APIRouter(prefix="/photos", tags=["photos"])

_HEIGHT_MIN, _HEIGHT_MAX = MEASUREMENT_RANGES["height_cm"]
_ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 411, 413, 415, 422, 429, 503)
}

_limiter: RateLimiter | None = None


def _rate_limit(user: CurrentUserDep, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter(settings.estimate_rate_limit, settings.estimate_rate_window_seconds)
    retry_after = _limiter.check(user.id)
    if retry_after is not None:
        raise AppError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many photo attempts. Please wait a few minutes and try again.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )


def get_pose_detector(settings: Annotated[Settings, Depends(get_settings)]) -> PoseDetector:
    try:
        return service.get_detector(settings.pose_model_path)
    except FileNotFoundError as exc:
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "estimation_unavailable",
            "Photo measurements are not available right now.",
        ) from exc


async def _read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    data = await upload.read(max_bytes + 1)
    await upload.close()
    if len(data) > max_bytes:
        raise AppError(
            status.HTTP_413_CONTENT_TOO_LARGE, "too_large", "Photos must be 10 MB or smaller."
        )
    return data


@router.post(
    "/estimate",
    response_model=PhotoEstimate,
    responses=_ERRORS,
    dependencies=[Depends(_rate_limit)],
)
async def estimate_photo(
    user: CurrentUserDep,
    settings: Annotated[Settings, Depends(get_settings)],
    detector: Annotated[PoseDetector, Depends(get_pose_detector)],
    front_photo: Annotated[UploadFile, File(description="Full-body photo, facing the camera.")],
    height_cm: Annotated[float, Form(ge=_HEIGHT_MIN, le=_HEIGHT_MAX)],
    consent: Annotated[bool, Form(description="The user agreed to have this photo processed.")],
    session: SessionDep,
    store: OptionalPhotoStore,
    side_photo: Annotated[
        UploadFile | None, File(description="Optional side-on photo for better accuracy.")
    ] = None,
    keep_photos: Annotated[
        bool,
        Form(description="The user opted to keep these photos for their 3D try-on preview."),
    ] = False,
) -> PhotoEstimate:
    """Estimate measurements from a photo. Photos are processed in memory and never stored."""
    if not consent:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "consent_required",
            "Please agree to photo processing first.",
        )
    if keep_photos and store is None:
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "photo_storage_unavailable",
            "Keeping photos is not available right now. Untick it to continue.",
        )
    front = await _read_limited(front_photo, settings.max_photo_bytes)
    side = await _read_limited(side_photo, settings.max_photo_bytes) if side_photo else None
    try:
        keep = None
        if keep_photos and store is not None:
            photo_store = store

            async def keep(
                photos: Sequence[tuple[profile_photos.PhotoKind, RGBImage]],
            ) -> list[UUID]:
                return await profile_photos.keep_photos(session, photo_store, user.id, photos)

        return await service.estimate_from_photos(detector, front, side, height_cm, keep)
    except service.PhotoError as exc:
        raise AppError(exc.status_code, exc.code, exc.message) from exc
    except RetakeError as exc:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "photo_retake",
            exc.message,
            details=[{"reason": exc.code}],
        ) from exc
    finally:
        del front, side
