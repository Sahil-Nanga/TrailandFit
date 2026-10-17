import logging
from typing import Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import AppError, ErrorResponse
from app.db.session import SessionDep

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"] | None = None


@router.get(
    "/health",
    response_model=HealthResponse,
    response_model_exclude_none=True,
    responses={503: {"model": ErrorResponse}},
)
async def health(
    session: SessionDep,
    db: bool = Query(default=False, description="Also check the database connection."),
) -> HealthResponse:
    """Liveness check. Public; returns no user data."""
    if not db:
        return HealthResponse(status="ok")
    try:
        await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("Database health check failed: %s", type(exc).__name__)
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "database_unavailable", "Database unavailable."
        ) from exc
    return HealthResponse(status="ok", database="ok")
