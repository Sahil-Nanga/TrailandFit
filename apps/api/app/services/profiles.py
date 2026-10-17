"""Measurement profile business logic.

Every function takes the caller's user id and scopes every query by it. A profile owned by
someone else behaves exactly like one that does not exist.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ProfileRow
from app.schemas import (
    MEASUREMENT_FIELDS,
    MeasurementProfile,
    Measurements,
    ProfileCreate,
    ProfilePage,
    ProfileUpdate,
)


class ProfileNotFoundError(Exception):
    pass


def _to_schema(row: ProfileRow) -> MeasurementProfile:
    return MeasurementProfile(
        id=row.id,
        user_id=row.user_id,
        name=row.name,
        measurements=Measurements(**{f: getattr(row, f) for f in MEASUREMENT_FIELDS}),
        source=row.source,  # validated here; also constrained by a CHECK constraint
        confidence=row.confidence,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _apply_measurements(row: ProfileRow, measurements: Measurements) -> None:
    for field, value in measurements.model_dump().items():
        setattr(row, field, value)


async def _get_owned_row(session: AsyncSession, user_id: str, profile_id: UUID) -> ProfileRow:
    row = await session.scalar(
        select(ProfileRow).where(ProfileRow.id == profile_id, ProfileRow.user_id == user_id)
    )
    if row is None:
        raise ProfileNotFoundError
    return row


async def list_profiles(
    session: AsyncSession, user_id: str, *, limit: int, offset: int
) -> ProfilePage:
    total = await session.scalar(
        select(func.count()).select_from(ProfileRow).where(ProfileRow.user_id == user_id)
    )
    rows = await session.scalars(
        select(ProfileRow)
        .where(ProfileRow.user_id == user_id)
        .order_by(ProfileRow.created_at.desc(), ProfileRow.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return ProfilePage(
        items=[_to_schema(row) for row in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


async def get_profile(session: AsyncSession, user_id: str, profile_id: UUID) -> MeasurementProfile:
    return _to_schema(await _get_owned_row(session, user_id, profile_id))


async def create_profile(
    session: AsyncSession, user_id: str, data: ProfileCreate
) -> MeasurementProfile:
    row = ProfileRow(
        user_id=user_id,
        name=data.name,
        source=data.source,
        confidence=data.confidence,
    )
    _apply_measurements(row, data.measurements)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _to_schema(row)


async def update_profile(
    session: AsyncSession, user_id: str, profile_id: UUID, data: ProfileUpdate
) -> MeasurementProfile:
    row = await _get_owned_row(session, user_id, profile_id)
    if data.name is not None:
        row.name = data.name
    if data.measurements is not None:
        current = _to_schema(row).measurements
        if data.measurements != current:
            _apply_measurements(row, data.measurements)
            # Photo estimates the user has corrected are no longer pure estimates.
            if row.source == "photo":
                row.source = "photo_edited"
    await session.commit()
    await session.refresh(row)
    return _to_schema(row)


async def delete_profile(session: AsyncSession, user_id: str, profile_id: UUID) -> None:
    row = await _get_owned_row(session, user_id, profile_id)
    await session.delete(row)
    await session.commit()
