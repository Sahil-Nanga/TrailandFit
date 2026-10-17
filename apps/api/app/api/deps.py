"""Shared route dependencies."""

from typing import Annotated

from fastapi import Depends, status

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.storage import PhotoStore, SupabasePhotoStore

_store: SupabasePhotoStore | None = None


def get_photo_store(settings: Annotated[Settings, Depends(get_settings)]) -> PhotoStore | None:
    """Private photo storage, or None when it is not configured (keeping photos disabled)."""
    global _store
    if settings.supabase_url is None or settings.supabase_secret_key is None:
        return None
    if _store is None:
        _store = SupabasePhotoStore(
            str(settings.supabase_url),
            settings.supabase_secret_key.get_secret_value(),
            settings.photo_bucket,
        )
    return _store


async def close_photo_store() -> None:
    global _store
    if _store is not None:
        await _store.aclose()
        _store = None


def require_photo_store(
    store: Annotated[PhotoStore | None, Depends(get_photo_store)],
) -> PhotoStore:
    if store is None:
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "photo_storage_unavailable",
            "Keeping photos is not available right now.",
        )
    return store


OptionalPhotoStore = Annotated[PhotoStore | None, Depends(get_photo_store)]
RequiredPhotoStore = Annotated[PhotoStore, Depends(require_photo_store)]
