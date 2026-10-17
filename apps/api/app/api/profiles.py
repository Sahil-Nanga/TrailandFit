from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import OptionalPhotoStore, RequiredPhotoStore
from app.core.config import Settings, get_settings
from app.core.errors import AppError, ErrorResponse
from app.core.security import CurrentUserDep
from app.db.session import SessionDep
from app.schemas import MeasurementProfile, ProfileCreate, ProfilePage, ProfilePhoto, ProfileUpdate
from app.services import profile_photos
from app.services import profiles as service

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}
_ERRORS_WITH_404: dict[int | str, dict[str, Any]] = {**_ERRORS, 404: {"model": ErrorResponse}}

router = APIRouter(prefix="/profiles", tags=["profiles"], responses=_ERRORS)


@contextmanager
def _not_found_as_404() -> Iterator[None]:
    try:
        yield
    except service.ProfileNotFoundError as exc:
        raise AppError(
            status.HTTP_404_NOT_FOUND, "profile_not_found", "Profile not found."
        ) from exc


@router.get("", response_model=ProfilePage)
async def list_profiles(
    user: CurrentUserDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProfilePage:
    """List the caller's profiles, newest first."""
    return await service.list_profiles(session, user.id, limit=limit, offset=offset)


@router.post("", response_model=MeasurementProfile, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: ProfileCreate, user: CurrentUserDep, session: SessionDep
) -> MeasurementProfile:
    try:
        return await service.create_profile(session, user.id, body)
    except profile_photos.PhotosNotFoundError as exc:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "photos_not_found",
            "Those photos are no longer available. Take the photos again to keep them.",
        ) from exc


@router.get("/{profile_id}", response_model=MeasurementProfile, responses=_ERRORS_WITH_404)
async def get_profile(
    profile_id: UUID, user: CurrentUserDep, session: SessionDep
) -> MeasurementProfile:
    with _not_found_as_404():
        return await service.get_profile(session, user.id, profile_id)


@router.patch("/{profile_id}", response_model=MeasurementProfile, responses=_ERRORS_WITH_404)
async def update_profile(
    profile_id: UUID, body: ProfileUpdate, user: CurrentUserDep, session: SessionDep
) -> MeasurementProfile:
    """Rename a profile and/or replace its measurements."""
    with _not_found_as_404():
        return await service.update_profile(session, user.id, profile_id, body)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT, responses=_ERRORS_WITH_404)
async def delete_profile(
    profile_id: UUID, user: CurrentUserDep, session: SessionDep, store: OptionalPhotoStore
) -> Response:
    """Delete a profile and any photos kept for it."""
    with _not_found_as_404():
        try:
            await service.delete_profile(session, user.id, profile_id, store)
        except service.PhotoStorageUnavailableError as exc:
            raise AppError(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "photo_storage_unavailable",
                "Try again shortly.",
            ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{profile_id}/photos", response_model=list[ProfilePhoto], responses=_ERRORS_WITH_404)
async def list_profile_photos(
    profile_id: UUID,
    user: CurrentUserDep,
    session: SessionDep,
    store: RequiredPhotoStore,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[ProfilePhoto]:
    """Photos kept for this profile, as short-lived signed URLs (for the 3D try-on)."""
    with _not_found_as_404():
        await service.get_profile(session, user.id, profile_id)
    return await profile_photos.list_photos(
        session, store, user.id, profile_id, settings.photo_url_seconds
    )


@router.delete(
    "/{profile_id}/photos", status_code=status.HTTP_204_NO_CONTENT, responses=_ERRORS_WITH_404
)
async def delete_profile_photos(
    profile_id: UUID, user: CurrentUserDep, session: SessionDep, store: RequiredPhotoStore
) -> Response:
    """Delete all photos kept for this profile. The measurements stay."""
    with _not_found_as_404():
        await service.get_profile(session, user.id, profile_id)
    await profile_photos.delete_photos(session, store, user.id, profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
