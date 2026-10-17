import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas import MEASUREMENT_FIELDS, MeasurementProfile, Measurements


def _profile(**overrides: Any) -> dict[str, Any]:
    now = datetime.now(UTC)
    data: dict[str, Any] = {
        "id": uuid.uuid4(),
        "user_id": "user-1",
        "name": "Everyday",
        "measurements": {"height_cm": 175.0, "chest_cm": 98.5, "waist_cm": 82.0},
        "source": "manual",
        "confidence": None,
        "created_at": now,
        "updated_at": now,
    }
    data.update(overrides)
    return data


def test_height_only_is_valid() -> None:
    m = Measurements(height_cm=170)
    assert m.height_cm == 170
    assert m.chest_cm is None


def test_full_measurements_valid() -> None:
    m = Measurements(
        height_cm=180,
        weight_kg=78,
        chest_cm=100,
        waist_cm=85,
        hips_cm=98,
        shoulder_width_cm=46,
        inseam_cm=82,
        sleeve_cm=64,
        neck_cm=39,
        thigh_cm=56,
    )
    assert m.model_dump(exclude_none=True).keys() == MEASUREMENT_FIELDS


def test_height_is_required() -> None:
    with pytest.raises(ValidationError):
        Measurements.model_validate({"chest_cm": 100})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("height_cm", 3),  # the example from AGENT.md
        ("height_cm", 400),
        ("weight_kg", 5),
        ("waist_cm", 820),  # entered in millimetres
        ("chest_cm", -1),
        ("neck_cm", 0),
    ],
)
def test_out_of_range_rejected(field: str, value: float) -> None:
    data: dict[str, Any] = {"height_cm": 170, field: value}
    with pytest.raises(ValidationError) as exc:
        Measurements.model_validate(data)
    assert exc.value.errors()[0]["loc"] == (field,)


def test_unknown_measurement_field_rejected() -> None:
    with pytest.raises(ValidationError):
        Measurements.model_validate({"height_cm": 170, "wingspan_cm": 180})


def test_profile_valid() -> None:
    profile = MeasurementProfile.model_validate(_profile())
    assert profile.measurements.height_cm == 175.0


def test_profile_name_is_trimmed() -> None:
    assert MeasurementProfile.model_validate(_profile(name="  Gym  ")).name == "Gym"


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
def test_profile_name_invalid(name: str) -> None:
    with pytest.raises(ValidationError):
        MeasurementProfile.model_validate(_profile(name=name))


def test_profile_source_must_be_known() -> None:
    with pytest.raises(ValidationError):
        MeasurementProfile.model_validate(_profile(source="guess"))


def test_photo_profile_with_confidence() -> None:
    profile = MeasurementProfile.model_validate(
        _profile(source="photo", confidence={"chest_cm": 0.82, "waist_cm": 0.4})
    )
    assert profile.confidence == {"chest_cm": 0.82, "waist_cm": 0.4}


@pytest.mark.parametrize("value", [-0.1, 1.01])
def test_confidence_out_of_range(value: float) -> None:
    with pytest.raises(ValidationError):
        MeasurementProfile.model_validate(_profile(confidence={"chest_cm": value}))


def test_confidence_unknown_field() -> None:
    with pytest.raises(ValidationError):
        MeasurementProfile.model_validate(_profile(confidence={"wingspan_cm": 0.5}))
