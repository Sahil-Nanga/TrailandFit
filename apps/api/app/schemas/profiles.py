"""Request and response bodies for /v1/profiles."""

from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.measurements import (
    ConfidenceMap,
    MeasurementProfile,
    Measurements,
    ProfileName,
)


class ProfileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ProfileName = "My measurements"
    measurements: Measurements
    # "photo_edited" is accepted so the photo flow can save in one call after the user edits.
    source: Literal["manual", "photo", "photo_edited"] = "manual"
    confidence: ConfidenceMap | None = None
    # Photos kept during the photo estimate (opt-in), to attach to this profile.
    photo_ids: list[UUID] = Field(default_factory=list, max_length=2)

    @model_validator(mode="after")
    def _confidence_only_for_photos(self) -> Self:
        if self.source == "manual" and self.confidence is not None:
            raise ValueError("Manual profiles cannot include confidence scores.")
        return self


class ProfileUpdate(BaseModel):
    """Partial update. `measurements`, when sent, replaces the whole set of values."""

    model_config = ConfigDict(extra="forbid")

    name: ProfileName | None = None
    measurements: Measurements | None = None

    @model_validator(mode="after")
    def _not_empty_or_null(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update.")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"'{field}' cannot be null.")
        return self


class ProfilePage(BaseModel):
    items: list[MeasurementProfile]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
