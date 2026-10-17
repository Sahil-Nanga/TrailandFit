from typing import Any

from fastapi import APIRouter, status

from app.core.errors import AppError, ErrorResponse
from app.core.security import CurrentUserDep
from app.db.session import SessionDep
from app.schemas import AccountSettings, AccountSettingsUpdate
from app.services import account as service

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}

router = APIRouter(prefix="/account", tags=["account"], responses=_ERRORS)


@router.get("/settings", response_model=AccountSettings)
async def get_settings(user: CurrentUserDep, session: SessionDep) -> AccountSettings:
    """The caller's settings, including which profile is active."""
    return await service.get_settings(session, user.id)


@router.patch("/settings", response_model=AccountSettings)
async def update_settings(
    body: AccountSettingsUpdate, user: CurrentUserDep, session: SessionDep
) -> AccountSettings:
    """Choose the active profile (it must be one of the caller's own profiles)."""
    try:
        return await service.update_settings(session, user.id, body)
    except service.ProfileNotOwnedError as exc:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "profile_not_found", "Profile not found."
        ) from exc
