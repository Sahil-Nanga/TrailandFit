"""Saved clothing links. Every query is scoped to the caller's user id."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SavedItemRow
from app.schemas import SavedItem, SavedItemCreate, SavedItemPage


class SavedItemNotFoundError(Exception):
    pass


def _to_schema(row: SavedItemRow) -> SavedItem:
    return SavedItem(id=row.id, url=row.url, title=row.title, created_at=row.created_at)


async def list_saved_items(
    session: AsyncSession, user_id: str, *, limit: int, offset: int
) -> SavedItemPage:
    total = await session.scalar(
        select(func.count()).select_from(SavedItemRow).where(SavedItemRow.user_id == user_id)
    )
    rows = await session.scalars(
        select(SavedItemRow)
        .where(SavedItemRow.user_id == user_id)
        .order_by(SavedItemRow.created_at.desc(), SavedItemRow.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return SavedItemPage(
        items=[_to_schema(row) for row in rows], total=total or 0, limit=limit, offset=offset
    )


async def save_item(session: AsyncSession, user_id: str, data: SavedItemCreate) -> SavedItem:
    """Saving the same URL twice returns the existing item instead of a duplicate."""
    url = str(data.url)
    existing = await _find_by_url(session, user_id, url)
    if existing is not None:
        return _to_schema(existing)
    row = SavedItemRow(user_id=user_id, url=url, title=data.title or None)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent request saved the same URL first (unique per user).
        await session.rollback()
        existing = await _find_by_url(session, user_id, url)
        if existing is None:
            raise
        return _to_schema(existing)
    await session.refresh(row)
    return _to_schema(row)


async def _find_by_url(session: AsyncSession, user_id: str, url: str) -> SavedItemRow | None:
    return await session.scalar(
        select(SavedItemRow).where(SavedItemRow.user_id == user_id, SavedItemRow.url == url)
    )


async def delete_saved_item(session: AsyncSession, user_id: str, item_id: UUID) -> None:
    row = await session.scalar(
        select(SavedItemRow).where(SavedItemRow.id == item_id, SavedItemRow.user_id == user_id)
    )
    if row is None:
        raise SavedItemNotFoundError
    await session.delete(row)
    await session.commit()
