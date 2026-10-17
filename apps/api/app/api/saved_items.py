from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.core.errors import AppError, ErrorResponse
from app.core.security import CurrentUserDep
from app.db.session import SessionDep
from app.schemas import SavedItem, SavedItemCreate, SavedItemPage, SavedItemUpdate
from app.services import saved_items as service

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}

router = APIRouter(prefix="/saved-items", tags=["saved items"], responses=_ERRORS)


@router.get("", response_model=SavedItemPage)
async def list_saved_items(
    user: CurrentUserDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SavedItemPage:
    """The caller's saved clothing pages, newest first."""
    return await service.list_saved_items(session, user.id, limit=limit, offset=offset)


@router.post("", response_model=SavedItem, status_code=status.HTTP_201_CREATED)
async def save_item(body: SavedItemCreate, user: CurrentUserDep, session: SessionDep) -> SavedItem:
    """Save a clothing page for later. Saving the same URL again returns the existing item."""
    return await service.save_item(session, user.id, body)


@router.patch("/{item_id}", response_model=SavedItem, responses={404: {"model": ErrorResponse}})
async def update_saved_item(
    item_id: UUID, body: SavedItemUpdate, user: CurrentUserDep, session: SessionDep
) -> SavedItem:
    """Change an item's category (top / bottom / other)."""
    try:
        return await service.update_saved_item(session, user.id, item_id, body)
    except service.SavedItemNotFoundError as exc:
        raise AppError(
            status.HTTP_404_NOT_FOUND, "saved_item_not_found", "Item not found."
        ) from exc


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse}},
)
async def delete_saved_item(item_id: UUID, user: CurrentUserDep, session: SessionDep) -> Response:
    try:
        await service.delete_saved_item(session, user.id, item_id)
    except service.SavedItemNotFoundError as exc:
        raise AppError(
            status.HTTP_404_NOT_FOUND, "saved_item_not_found", "Item not found."
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
