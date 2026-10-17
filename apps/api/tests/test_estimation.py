import ast
from pathlib import Path

import numpy as np
import pytest

from app.estimation import Estimate, RetakeError, estimate
from app.estimation.detector import MultiplePeopleError
from app.estimation.geometry import ellipse_perimeter, runs
from app.estimation.measure import ASSUMED_DEPTH_RATIO
from app.estimation.types import BodyScan, Landmark, RGBImage
from tests import synthetic_body as body

HEIGHT_CM = 175.0
CM_PER_PX = HEIGHT_CM / (body.BOTTOM - body.TOP)
BLANK: RGBImage = np.zeros((body.H, body.W, 3), dtype=np.uint8)


class FakeDetector:
    """Returns prepared scans in order; stands in for MediaPipe."""

    def __init__(self, *scans: BodyScan | Exception | None) -> None:
        self._scans = list(scans)

    def detect(self, image: RGBImage) -> BodyScan | None:
        item = self._scans.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _run(*scans: BodyScan | Exception | None, side: bool = False) -> Estimate:
    return estimate(FakeDetector(*scans), BLANK, BLANK if side else None, HEIGHT_CM)


def _expected_circumference(width_px: float, depth_px: float | None, part: str) -> float:
    width = width_px * CM_PER_PX
    depth = depth_px * CM_PER_PX if depth_px is not None else width * ASSUMED_DEPTH_RATIO[part]
    return ellipse_perimeter(width, depth)


# --- geometry ----------------------------------------------------------------------------


def test_runs() -> None:
    row = np.array([0, 1, 1, 0, 0, 1, 0, 1, 1, 1], dtype=bool)
    assert runs(row) == [(1, 3), (5, 6), (7, 10)]


def test_ellipse_perimeter_matches_circle() -> None:
    assert ellipse_perimeter(10, 10) == pytest.approx(np.pi * 10)


# --- measurements on the synthetic figure ----------------------------------------------


def test_front_only_measurements() -> None:
    result = _run(body.front_scan())
    v = result.values

    assert v["shoulder_width_cm"] == pytest.approx(140 * CM_PER_PX * 1.15, abs=0.2)
    assert v["inseam_cm"] == pytest.approx((body.ANKLE_Y - body.CROTCH_Y) * CM_PER_PX, abs=0.5)
    # Chest is taken on the first row below the armpits that is clear of the arms, where the
    # torso is a little narrower than at the nominal chest level.
    chest_max = _expected_circumference(body.CHEST_W, None, "chest")
    waist = _expected_circumference(body.WAIST_W, None, "waist")
    assert waist < v["chest_cm"] <= chest_max + 1.5
    assert v["waist_cm"] == pytest.approx(
        _expected_circumference(body.WAIST_W, None, "waist"), abs=1.5
    )
    assert v["hips_cm"] == pytest.approx(
        _expected_circumference(body.HIPS_W, None, "hips"), abs=1.5
    )
    assert v["thigh_cm"] == pytest.approx(
        _expected_circumference(body.LEG_W, None, "thigh"), abs=1.5
    )
    assert 50 < v["sleeve_cm"] < 75
    assert "weight_kg" not in v
    assert "neck_cm" not in v  # not estimated from photos until benchmarked
    assert all(0 <= c <= 1 for c in result.confidence.values())
    assert any("side photo" in note for note in result.notes)


def test_side_photo_uses_measured_depth_and_raises_confidence() -> None:
    front_only = _run(body.front_scan())
    with_side = _run(body.front_scan(), body.side_scan(), side=True)

    expected = _expected_circumference(body.WAIST_W, body.WAIST_DEPTH, "waist")
    assert with_side.values["waist_cm"] == pytest.approx(expected, abs=1.5)
    assert with_side.confidence["waist_cm"] > front_only.confidence["waist_cm"]
    assert not any("side photo" in note for note in with_side.notes)
    assert "neck_cm" not in with_side.values


def test_arms_against_chest_measures_lower_or_skips() -> None:
    # The standard figure's upper arms touch the chest at the nominal chest level; the
    # estimate must not include the arms (which would read ~120 cm here).
    result = _run(body.front_scan())
    assert result.values["chest_cm"] < 100


def test_low_resolution_lowers_confidence_and_adds_tip() -> None:
    sharp = _run(body.front_scan())
    small = _run(body.downscaled(body.front_scan(), 2))  # ~400 px of body height

    assert small.values["shoulder_width_cm"] == pytest.approx(
        sharp.values["shoulder_width_cm"], abs=1.5
    )
    for field, confidence in small.confidence.items():
        assert confidence < sharp.confidence[field]
    assert any("higher-resolution" in note for note in small.notes)
    assert not any("higher-resolution" in note for note in sharp.notes)


def test_hands_at_hips_are_not_counted_in_hips() -> None:
    result = _run(body.front_scan(body.Figure(hands_at_hips=True)))
    expected = _expected_circumference(body.HIPS_W, None, "hips")
    # Either measured clear of the hands, or skipped; never inflated by them.
    if "hips_cm" in result.values:
        assert result.values["hips_cm"] == pytest.approx(expected, abs=2.0)


def test_feet_together_skips_inseam_and_thigh() -> None:
    result = _run(body.front_scan(body.Figure(feet_together=True)))
    assert "inseam_cm" not in result.values
    assert "thigh_cm" not in result.values
    assert any("feet slightly apart" in note for note in result.notes)


def test_low_visibility_lowers_confidence() -> None:
    clear = _run(body.front_scan())
    blurry = _run(
        body.with_visibility(
            body.with_visibility(body.front_scan(), Landmark.LEFT_WRIST, 0.55),
            Landmark.RIGHT_WRIST,
            0.55,
        )
    )
    assert blurry.confidence["sleeve_cm"] < clear.confidence["sleeve_cm"]


# --- retake reasons ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("scans", "code"),
    [
        pytest.param((None,), "no_person", id="nobody"),
        pytest.param((MultiplePeopleError(),), "multiple_people", id="two-people"),
        pytest.param((body.shifted(body.front_scan(), -body.TOP),), "cropped", id="head-cut-off"),
        pytest.param((body.shifted(body.front_scan(), 101),), "cropped", id="feet-cut-off"),
        pytest.param((body.shrunk(body.front_scan(), 3),), "too_far", id="too-far"),
        pytest.param(
            (body.with_visibility(body.front_scan(), Landmark.LEFT_ANKLE, 0.1),),
            "body_not_visible",
            id="ankle-hidden",
        ),
        pytest.param(
            (body.front_scan(body.Figure(shoulder_tilt=20)),), "not_straight", id="tilted"
        ),
        pytest.param(
            (body.front_scan(body.Figure(arms_touching=True)),), "arms_touching", id="arms-in"
        ),
        pytest.param((body.side_scan(),), "not_facing", id="side-photo-as-front"),
    ],
)
def test_front_retake_reasons(scans: tuple[BodyScan | Exception | None, ...], code: str) -> None:
    with pytest.raises(RetakeError) as exc:
        _run(*scans)
    assert exc.value.code == code
    assert exc.value.message  # always something the user can act on


def test_front_photo_used_as_side_photo() -> None:
    with pytest.raises(RetakeError) as exc:
        _run(body.front_scan(), body.front_scan(), side=True)
    assert exc.value.code == "not_side"
    assert "side photo" in exc.value.message


# --- isolation ---------------------------------------------------------------------------


def test_estimation_has_no_web_or_database_imports() -> None:
    forbidden = (
        "fastapi",
        "starlette",
        "sqlalchemy",
        "app.api",
        "app.db",
        "app.models",
        "app.core",
    )
    package = Path(__file__).resolve().parent.parent / "app" / "estimation"
    for path in package.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                assert not name.startswith(forbidden), f"{path.name} imports {name}"
