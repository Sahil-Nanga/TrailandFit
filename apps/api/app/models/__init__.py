"""SQLAlchemy ORM models. Alembic autogenerates migrations from `Base.metadata`."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.schemas import MEASUREMENT_RANGES

# Deterministic constraint names, so migrations can refer to them (op.f("pk_...")).
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class ProfileRow(Base):
    __tablename__ = "measurement_profiles"
    __table_args__ = (
        CheckConstraint("source IN ('manual', 'photo', 'photo_edited')", name="source"),
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        # Same ranges the API validates against.
        *(
            CheckConstraint(f"{field} BETWEEN {low} AND {high}", name=f"{field}_range")
            for field, (low, high) in MEASUREMENT_RANGES.items()
        ),
        Index("ix_measurement_profiles_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(100))
    height_cm: Mapped[float] = mapped_column(Double)
    weight_kg: Mapped[float | None] = mapped_column(Double)
    chest_cm: Mapped[float | None] = mapped_column(Double)
    waist_cm: Mapped[float | None] = mapped_column(Double)
    hips_cm: Mapped[float | None] = mapped_column(Double)
    shoulder_width_cm: Mapped[float | None] = mapped_column(Double)
    inseam_cm: Mapped[float | None] = mapped_column(Double)
    sleeve_cm: Mapped[float | None] = mapped_column(Double)
    neck_cm: Mapped[float | None] = mapped_column(Double)
    thigh_cm: Mapped[float | None] = mapped_column(Double)
    source: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SavedItemRow(Base):
    __tablename__ = "saved_items"
    __table_args__ = (
        UniqueConstraint("user_id", "url", name="uq_saved_items_user_id_url"),
        CheckConstraint("category IN ('top', 'bottom', 'other')", name="category"),
        Index("ix_saved_items_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(10), server_default="other", default="other")
    image_url: Mapped[str | None] = mapped_column(Text)
    # As read from the shop's page (validated by the SavedItem schemas).
    sizes: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    size_chart: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class AccountSettingsRow(Base):
    __tablename__ = "account_settings"

    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    active_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("measurement_profiles.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProfilePhotoRow(Base):
    __tablename__ = "profile_photos"
    __table_args__ = (CheckConstraint("kind IN ('front', 'side')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("measurement_profiles.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10))
    storage_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
