"""Fit shape parameters so the body's measured dimensions match the requested ones.

Height sets a uniform scale exactly. The remaining dimensions are matched with bounded
non-linear least squares on the real mesh measurements, with gentle priors that keep the body
close to average where the measurements don't say otherwise.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy.optimize import least_squares

from body_fit.body import FREE, Body, load_body, shape_weights
from body_fit.measure import DIMENSIONS, Levels, find_levels, measure, measure_at

TOLERANCE_M = 0.015  # "within 1-2 cm"
TARGETS = ("chest", "waist", "hips", "shoulderWidth", "inseam")

# How strongly each parameter is pulled back to its default (in "metres of error" units).
PRIOR = {"build": 0.02, "muscle": 0.02, "belly": 0.01, "legs": 0.005}
PRIOR_DEFAULT = 0.005


@dataclass(frozen=True)
class FitResult:
    weights: dict[str, float]
    params: dict[str, float]
    scale: float
    measured: dict[str, float]  # metres, after scaling
    residuals: dict[str, float]  # measured - target, metres
    within_tolerance: bool


def build_from_bmi(height_cm: float, weight_kg: float | None) -> float:
    if not weight_kg:
        return 0.5
    bmi = weight_kg / (height_cm / 100) ** 2
    value = 0.5 * (bmi - 17) / 5 if bmi <= 22 else 0.5 + 0.5 * (bmi - 22) / 10
    return min(1.0, max(0.0, value))


def _bounds() -> tuple[list[float], list[float]]:
    low = [0.0 if p in ("build", "muscle") else -1.0 for p in FREE]
    return low, [1.0] * len(FREE)


def fit(
    targets_cm: Mapping[str, float | None],
    body_type: float,
    weight_kg: float | None = None,
    body: Body | None = None,
) -> FitResult:
    """targets_cm: height (required) plus any of chest, waist, hips, shoulderWidth, inseam."""
    body = body or load_body()
    height = float(targets_cm["height"] or 0) / 100
    wanted = {k: float(v) / 100 for k, v in targets_cm.items() if k in TARGETS and v}
    prior = {p: 0.5 if p in ("build", "muscle") else 0.0 for p in FREE}
    prior["build"] = build_from_bmi(height * 100, weight_kg)

    def params_of(x: np.ndarray) -> dict[str, float]:
        return dict(zip(FREE, (float(v) for v in x), strict=True))

    def evaluate(x: np.ndarray, levels: Levels) -> tuple[dict[str, float], float]:
        weights = shape_weights(body_type, params_of(x))
        pos = body.positions(weights)
        joints = body.joint_positions(pos)
        m = measure_at(pos, body.tris, joints, levels)
        # Inseam: leg morphs are pure length changes; track it from the neutral crotch level.
        m["inseam"] = inseam_base + _inseam_offset(body, weights)
        return m, height / m["height"]

    x = np.array([prior[p] for p in FREE])
    start = body.positions(shape_weights(body_type, prior))
    full = measure(start, body.tris, body.joint_positions(start))
    inseam_base = full["inseam"] - _inseam_offset(body, shape_weights(body_type, prior))
    levels = find_levels(start, body.tris, body.joint_positions(start))

    for _round in range(2):

        def residuals(x: np.ndarray, levels: Levels = levels) -> np.ndarray:
            m, scale = evaluate(x, levels)
            errors = [(m[k] * scale - v) for k, v in wanted.items()]
            priors = [PRIOR.get(p, PRIOR_DEFAULT) * (x[i] - prior[p]) for i, p in enumerate(FREE)]
            return np.array(errors + priors) / TOLERANCE_M

        solution = least_squares(
            residuals, x, bounds=_bounds(), diff_step=0.02, max_nfev=80, x_scale=0.3
        )
        x = solution.x
        pos = body.positions(shape_weights(body_type, params_of(x)))
        new_levels = find_levels(pos, body.tris, body.joint_positions(pos))
        if all(
            math.isclose(getattr(new_levels, f), getattr(levels, f), abs_tol=0.02)
            for f in ("chest", "waist", "hips")
        ):
            break
        levels = new_levels

    weights = shape_weights(body_type, params_of(x))
    pos = body.positions(weights)
    final = measure(pos, body.tris, body.joint_positions(pos))
    scale = height / final["height"]
    measured = {k: final[k] * scale for k in DIMENSIONS}
    residual = {k: measured[k] - v for k, v in wanted.items()}
    return FitResult(
        weights=weights,
        params=params_of(x),
        scale=scale,
        measured=measured,
        residuals=residual,
        within_tolerance=all(abs(r) <= TOLERANCE_M for r in residual.values()),
    )


def _inseam_offset(body: Body, weights: dict[str, float]) -> float:
    """Inseam change from the leg morphs (they change leg length only)."""
    effects = _leg_effects(body)
    return sum(weights.get(name, 0.0) * effect for name, effect in effects.items())


_LEG_MORPHS = ("upperLeg-incr", "upperLeg-decr", "lowerLeg-incr", "lowerLeg-decr")


@lru_cache
def _leg_effects(body: Body) -> dict[str, float]:
    """Inseam change (metres) of each leg morph at weight 1, measured once on the neutral body."""
    neutral = {"female": 0.5, "male": 0.5}
    base = body.positions(neutral)
    reference = measure(base, body.tris, body.joint_positions(base))["inseam"]
    effects = {}
    for name in _LEG_MORPHS:
        pos = body.positions({**neutral, name: 1.0})
        effects[name] = measure(pos, body.tris, body.joint_positions(pos))["inseam"] - reference
    return effects
