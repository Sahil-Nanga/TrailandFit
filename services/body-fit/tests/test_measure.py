import math

import numpy as np
import pytest

from body_fit.body import load_body
from body_fit.measure import measure, slice_loops, torso_circumference


def cylinder(
    radius: float, x0: float = 0.0, segments: int = 64, height: float = 1.0
) -> tuple[np.ndarray, np.ndarray]:
    angles = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    ring = np.stack(
        [x0 + radius * np.cos(angles), np.zeros(segments), radius * np.sin(angles)], axis=1
    )
    top = ring + np.array([0.0, height, 0.0])
    pos = np.vstack([ring, top])
    tris = []
    for i in range(segments):
        j = (i + 1) % segments
        tris += [[i, j, segments + i], [j, segments + j, segments + i]]
    return pos, np.array(tris)


def test_cylinder_circumference_is_its_perimeter() -> None:
    pos, tris = cylinder(0.15)
    expected = 64 * 2 * 0.15 * math.sin(math.pi / 64)  # perimeter of the 64-gon
    assert torso_circumference(pos, tris, 0.5) == pytest.approx(expected, rel=1e-6)


def test_separate_shapes_give_separate_loops_and_the_midline_one_is_chosen() -> None:
    a, ta = cylinder(0.1, x0=-0.3)
    b, tb = cylinder(0.2, x0=0.0)
    pos = np.vstack([a, b])
    tris = np.vstack([ta, tb + len(a)])
    assert len(slice_loops(pos, tris, 0.5)) == 2
    assert torso_circumference(pos, tris, 0.5) == pytest.approx(2 * math.pi * 0.2, rel=0.01)


def test_neutral_body_measurements_are_plausible() -> None:
    body = load_body()
    pos = body.positions({"female": 0.5, "male": 0.5})
    m = measure(pos, body.tris, body.joint_positions(pos))
    assert 1.6 < m["height"] < 1.75
    assert 0.80 < m["chest"] < 1.0
    assert 0.60 < m["waist"] < m["chest"]
    assert 0.85 < m["hips"] < 1.05
    assert 0.6 < m["inseam"] < 0.8
