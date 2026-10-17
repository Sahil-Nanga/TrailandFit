"""Photos users explicitly chose to keep for the 3D try-on.

Images are re-encoded from decoded pixels (so no EXIF or other metadata is stored), kept in a
private bucket, and only ever handed out as short-lived signed URLs. Nothing here is logged.
"""

import io
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from PIL import Image
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.estimation import RGBImage
from app.models import ProfilePhotoRow
from app.schemas import ProfilePhoto
from app.storage import PhotoStore

PENDING_TTL = timedelta(hours=1)
PhotoKind = Literal["front", "side"]


class PhotosNotFoundError(Exception):
    """Some photo ids are unknown, belong to someone else, expired or are already attached."""


def encode_jpeg(pixels: RGBImage) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


async def purge_stale_pending(session: AsyncSession, store: PhotoStore, user_id: str) -> None:
    cutoff = datetime.now(UTC) - PENDING_TTL
    rows = (
        await session.scalars(
            select(ProfilePhotoRow).where(
                ProfilePhotoRow.user_id == user_id,
                ProfilePhotoRow.profile_id.is_(None),
                ProfilePhotoRow.created_at < cutoff,
            )
        )
    ).all()
    if rows:
        await store.delete([r.storage_key for r in rows])
        await session.execute(
            delete(ProfilePhotoRow).where(ProfilePhotoRow.id.in_([r.id for r in rows]))
        )
        await session.commit()


async def keep_photos(
    session: AsyncSession,
    store: PhotoStore,
    user_id: str,
    photos: Sequence[tuple[PhotoKind, RGBImage]],
) -> list[UUID]:
    """Store opted-in photos as pending (not yet attached to a profile)."""
    await purge_stale_pending(session, store, user_id)
    ids: list[UUID] = []
    for kind, pixels in photos:
        photo_id = uuid.uuid4()
        key = f"{user_id}/{photo_id}.jpg"
        await store.put(key, encode_jpeg(pixels), "image/jpeg")
        session.add(ProfilePhotoRow(id=photo_id, user_id=user_id, kind=kind, storage_key=key))
        ids.append(photo_id)
    await session.commit()
    return ids


async def attach_photos(
    session: AsyncSession, user_id: str, profile_id: UUID, photo_ids: Sequence[UUID]
) -> None:
    """Attach pending photos to a just-created profile. Caller commits."""
    if not photo_ids:
        return
    cutoff = datetime.now(UTC) - PENDING_TTL
    rows = (
        await session.scalars(
            select(ProfilePhotoRow).where(
                ProfilePhotoRow.id.in_(list(photo_ids)),
                ProfilePhotoRow.user_id == user_id,
                ProfilePhotoRow.profile_id.is_(None),
                ProfilePhotoRow.created_at >= cutoff,
            )
        )
    ).all()
    if len(rows) != len(set(photo_ids)):
        raise PhotosNotFoundError
    for row in rows:
        row.profile_id = profile_id


async def list_photos(
    session: AsyncSession, store: PhotoStore, user_id: str, profile_id: UUID, expires_in: int
) -> list[ProfilePhoto]:
    rows = (
        await session.scalars(
            select(ProfilePhotoRow)
            .where(ProfilePhotoRow.user_id == user_id, ProfilePhotoRow.profile_id == profile_id)
            .order_by(ProfilePhotoRow.kind)
        )
    ).all()
    return [
        ProfilePhoto(
            id=row.id,
            kind=row.kind,  # validated here; also constrained by a CHECK constraint
            url=await store.signed_url(row.storage_key, expires_in),
            created_at=row.created_at,
        )
        for row in rows
    ]


async def photo_keys(session: AsyncSession, user_id: str, profile_id: UUID) -> list[str]:
    return list(
        (
            await session.scalars(
                select(ProfilePhotoRow.storage_key).where(
                    ProfilePhotoRow.user_id == user_id, ProfilePhotoRow.profile_id == profile_id
                )
            )
        ).all()
    )


async def delete_photos(
    session: AsyncSession, store: PhotoStore, user_id: str, profile_id: UUID
) -> int:
    keys = await photo_keys(session, user_id, profile_id)
    await store.delete(keys)
    await session.execute(
        delete(ProfilePhotoRow).where(
            ProfilePhotoRow.user_id == user_id, ProfilePhotoRow.profile_id == profile_id
        )
    )
    await session.commit()
    return len(keys)
