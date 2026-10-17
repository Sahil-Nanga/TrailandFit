"""Measurement schemas: the source of truth for API and generated TypeScript types.

All values are stored in centimetres and kilograms; unit conversion happens only in the UI.
"""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

# Plausible human ranges (inclusive). Wide enough for real people, tight enough to catch typos
# such as a height of 3 cm or a waist entered in millimetres. The database enforces the same
# ranges with CHECK constraints built from this dict.
MEASUREMENT_RANGES: dict[str, tuple[float, float]] = {
    "height_cm": (50, 272),
    "weight_kg": (20, 400),
    "chest_cm": (40, 250),
    "waist_cm": (30, 250),
    "hips_cm": (40, 250),
    "shoulder_width_cm": (20, 80),
    "inseam_cm": (30, 130),
    "sleeve_cm": (20, 110),
    "neck_cm": (20, 70),
    "thigh_cm": (20, 120),
}


def _ranged(name: str, description: str) -> Any:
    low, high = MEASUREMENT_RANGES[name]
    return Field(ge=low, le=high, description=description)


HeightCm = Annotated[float, _ranged("height_cm", "Height in cm.")]
WeightKg = Annotated[float, _ranged("weight_kg", "Weight in kg.")]
ChestCm = Annotated[float, _ranged("chest_cm", "Chest circumference in cm.")]
WaistCm = Annotated[float, _ranged("waist_cm", "Waist circumference in cm.")]
HipsCm = Annotated[float, _ranged("hips_cm", "Hip circumference in cm.")]
ShoulderWidthCm = Annotated[float, _ranged("shoulder_width_cm", "Shoulder width in cm.")]
InseamCm = Annotated[float, _ranged("inseam_cm", "Inseam length in cm.")]
SleeveCm = Annotated[float, _ranged("sleeve_cm", "Sleeve length in cm.")]
NeckCm = Annotated[float, _ranged("neck_cm", "Neck circumference in cm.")]
ThighCm = Annotated[float, _ranged("thigh_cm", "Thigh circumference in cm.")]


class Measurements(BaseModel):
    model_config = ConfigDict(extra="forbid")

    height_cm: HeightCm
    weight_kg: WeightKg | None = None
    chest_cm: ChestCm | None = None
    waist_cm: WaistCm | None = None
    hips_cm: HipsCm | None = None
    shoulder_width_cm: ShoulderWidthCm | None = None
    inseam_cm: InseamCm | None = None
    sleeve_cm: SleeveCm | None = None
    neck_cm: NeckCm | None = None
    thigh_cm: ThighCm | None = None


MEASUREMENT_FIELDS: frozenset[str] = frozenset(Measurements.model_fields)

MeasurementSource = Literal["manual", "photo", "photo_edited"]
Confidence = Annotated[float, Field(ge=0, le=1)]


def _known_measurement_keys(value: dict[str, float]) -> dict[str, float]:
    unknown = set(value) - MEASUREMENT_FIELDS
    if unknown:
        raise ValueError(f"Unknown measurement fields: {', '.join(sorted(unknown))}")
    return value


ConfidenceMap = Annotated[
    dict[str, Confidence],
    AfterValidator(_known_measurement_keys),
    Field(description="Per-field confidence (0..1), keyed by measurement field name. Photo only."),
]

ProfileName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class MeasurementProfile(BaseModel):
    id: UUID
    user_id: str
    name: ProfileName
    measurements: Measurements
    source: MeasurementSource
    confidence: ConfidenceMap | None = None
    created_at: datetime
    updated_at: datetime
