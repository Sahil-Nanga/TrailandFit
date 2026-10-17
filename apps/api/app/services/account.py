"""Account-level settings, scoped to the caller's user id."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AccountSettingsRow, ProfileRow
from app.schemas import AccountSettings, AccountSettingsUpdate


class ProfileNotOwnedError(Exception):
    """The profile does not exist or belongs to someone else."""


async def get_settings(session: AsyncSession, user_id: str) -> AccountSettings:
    row = await session.get(AccountSettingsRow, user_id)
    return AccountSettings(active_profile_id=row.active_profile_id if row else None)


async def update_settings(
    session: AsyncSession, user_id: str, data: AccountSettingsUpdate
) -> AccountSettings:
    profile_id: UUID | None = data.active_profile_id
    if profile_id is not None:
        owned = await session.scalar(
            select(ProfileRow.id).where(ProfileRow.id == profile_id, ProfileRow.user_id == user_id)
        )
        if owned is None:
            raise ProfileNotOwnedError
    row = await session.get(AccountSettingsRow, user_id)
    if row is None:
        row = AccountSettingsRow(user_id=user_id)
        session.add(row)
    row.active_profile_id = profile_id
    await session.commit()
    return AccountSettings(active_profile_id=profile_id)
