"""Saved clothing links. Every query is scoped to the caller's user id."""

import re
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SavedItemRow
from app.schemas import SavedItem, SavedItemCreate, SavedItemPage, SavedItemUpdate

# Words in product titles/URLs that say what kind of garment it is (English, Finnish, Swedish,
# German). Checked as substrings of the lowercased title and URL path.
_BOTTOM_WORDS = (
    "pants",
    "trousers",
    "jeans",
    "shorts",
    "joggers",
    "leggings",
    "tights",
    "chinos",
    "skirt",
    "sweatpants",
    "cargo",
    "housut",
    "farkut",
    "shortsit",
    "sortsit",
    "hame",
    "legginsit",
    "verkkarit",
    "collegehousut",
    "byxor",
    "jeansen",
    "kjol",
    "hose",
    "rock",
)
_TOP_WORDS = (
    "shirt",
    "t-shirt",
    "tee",
    "top",
    "hoodie",
    "hood",
    "sweater",
    "sweatshirt",
    "jumper",
    "cardigan",
    "polo",
    "blouse",
    "jacket",
    "coat",
    "vest",
    "fleece",
    "pullover",
    "tank",
    "paita",
    "huppari",
    "neule",
    "takki",
    "pusero",
    "liivi",
    "college",
    "tröja",
    "skjorta",
    "jacka",
    "kofta",
    "linne",
    "hemd",
    "pulli",
    "jacke",
)


def _mentions(text: str, words: tuple[str, ...]) -> bool:
    """Long words may sit inside compounds ("collegehousut"); short ones must stand alone."""
    tokens = set(re.split(r"[^a-z0-9äöåü]+", text))
    return any((word in text) if len(word) > 4 else (word in tokens) for word in words)


def guess_category(title: str | None, url: str) -> str:
    """Best guess of top / bottom / other from the product's title and URL path."""
    text = f"{title or ''} {url.split('?')[0]}".lower()
    if _mentions(text, _BOTTOM_WORDS):
        return "bottom"
    if _mentions(text, _TOP_WORDS):
        return "top"
    return "other"


class SavedItemNotFoundError(Exception):
    pass


def _to_schema(row: SavedItemRow) -> SavedItem:
    return SavedItem(
        id=row.id,
        url=row.url,
        title=row.title,
        category=row.category,  # validated here; also constrained by a CHECK constraint
        image_url=row.image_url,
        created_at=row.created_at,
    )


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
    row = SavedItemRow(
        user_id=user_id,
        url=url,
        title=data.title or None,
        category=data.category or guess_category(data.title, url),
        image_url=str(data.image_url) if data.image_url else None,
    )
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


async def update_saved_item(
    session: AsyncSession, user_id: str, item_id: UUID, data: SavedItemUpdate
) -> SavedItem:
    row = await session.scalar(
        select(SavedItemRow).where(SavedItemRow.id == item_id, SavedItemRow.user_id == user_id)
    )
    if row is None:
        raise SavedItemNotFoundError
    row.category = data.category
    await session.commit()
    await session.refresh(row)
    return _to_schema(row)


async def delete_saved_item(session: AsyncSession, user_id: str, item_id: UUID) -> None:
    row = await session.scalar(
        select(SavedItemRow).where(SavedItemRow.id == item_id, SavedItemRow.user_id == user_id)
    )
    if row is None:
        raise SavedItemNotFoundError
    await session.delete(row)
    await session.commit()
