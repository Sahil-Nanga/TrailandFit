import pytest

from body_fit.body import load_body, shape_weights
from body_fit.fit import fit
from body_fit.measure import measure

CM = 100


@pytest.mark.parametrize(
    ("body_type", "params"),
    [
        (
            0.0,
            {"build": 0.35, "muscle": 0.5, "chest": 0.2, "waist": -0.3, "hips": 0.4, "legs": 0.1},
        ),
        (1.0, {"build": 0.65, "muscle": 0.7, "shoulders": 0.4, "waist": 0.2, "legs": -0.2}),
        (0.5, {"build": 0.5, "muscle": 0.3, "chest": -0.2, "hips": 0.1}),
    ],
)
def test_round_trip_recovers_known_bodies_within_1cm(
    body_type: float, params: dict[str, float]
) -> None:
    body = load_body()
    pos = body.positions(shape_weights(body_type, params))
    truth = measure(pos, body.tris, body.joint_positions(pos))
    targets = {
        k: truth[k] * CM for k in ("height", "chest", "waist", "hips", "shoulderWidth", "inseam")
    }
    result = fit(targets, body_type)
    assert result.within_tolerance
    for k, residual in result.residuals.items():
        assert abs(residual) < 0.01, k


@pytest.mark.parametrize(
    ("targets", "body_type", "weight"),
    [
        (
            {
                "height": 179,
                "chest": 98,
                "waist": 84,
                "hips": 99,
                "shoulderWidth": 45,
                "inseam": 81,
            },
            0.8,
            74,
        ),
        ({"height": 158, "chest": 84, "waist": 66, "hips": 92, "inseam": 72}, 0.0, 52),
        ({"height": 188, "chest": 104, "waist": 88, "hips": 102, "inseam": 86}, 1.0, 85),
        ({"height": 168, "chest": 92, "waist": 74, "hips": 100}, 0.2, None),
    ],
)
def test_realistic_sets_fit_within_tolerance(
    targets: dict[str, float], body_type: float, weight: float | None
) -> None:
    result = fit(targets, body_type, weight)
    assert result.within_tolerance, result.residuals
    assert result.measured["height"] * CM == pytest.approx(targets["height"], abs=0.1)


def test_unreachable_targets_are_reported_not_raised() -> None:
    result = fit({"height": 170, "waist": 150}, 0.5)
    assert not result.within_tolerance
    assert result.residuals["waist"] < -0.1  # closest it can get, clearly short
    assert all(0 <= w <= 1 for w in result.weights.values())


def test_height_only_keeps_an_average_body() -> None:
    result = fit({"height": 175}, 0.5)
    assert result.residuals == {}
    assert result.params["build"] == pytest.approx(0.5, abs=0.01)
