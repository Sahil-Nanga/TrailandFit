from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.core.errors import AppError, ErrorResponse
from app.core.security import CurrentUserDep
from app.db.session import SessionDep
from app.schemas import MeasurementProfile, ProfileCreate, ProfilePage, ProfileUpdate
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
    return await service.create_profile(session, user.id, body)


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
async def delete_profile(profile_id: UUID, user: CurrentUserDep, session: SessionDep) -> Response:
    with _not_found_as_404():
        await service.delete_profile(session, user.id, profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
