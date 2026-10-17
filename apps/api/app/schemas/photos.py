from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.measurements import ConfidenceMap, Measurements


class PhotoEstimate(BaseModel):
    """Estimated measurements. Show them in the editable form; they are not saved yet."""

    measurements: Measurements
    confidence: ConfidenceMap
    notes: list[str] = Field(
        default_factory=list, description="Tips for a better result, safe to show the user."
    )
    kept_photo_ids: list[UUID] = Field(
        default_factory=list,
        description="Photos kept because the user opted in; pass them when saving the profile.",
    )


class ProfilePhoto(BaseModel):
    id: UUID
    kind: Literal["front", "side"]
    url: str = Field(description="Short-lived signed URL. Do not store or share it.")
    created_at: datetime
