"""The base body: mesh + morph targets, and how shape parameters become morph weights."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from body_fit.measure import F, I

DATA = Path(__file__).resolve().parent.parent / "data" / "body.npz"

# incr/decr morph pairs driven by one signed parameter in [-1, 1].
PAIRS = ("chest", "waist", "hips", "shoulders", "belly")
FREE = ("build", "muscle", *PAIRS, "legs")


@dataclass(frozen=True, eq=False)  # identity hash: usable as a cache key
class Body:
    base: F  # (n, 3) metres, feet near y = 0
    tris: I
    names: tuple[str, ...]
    deltas: F  # (m, n, 3)
    joints: dict[str, I]
    uvs: F  # (k, 2) texture coordinates, glTF convention (origin top left)
    tri_uvs: I  # (t, 3) index into uvs for each triangle corner

    def positions(self, weights: dict[str, float]) -> F:
        w = np.array([weights.get(name, 0.0) for name in self.names])
        return self.base + np.tensordot(w, self.deltas, axes=1)

    def joint_positions(self, pos: F) -> dict[str, F]:
        return {name: pos[ids].mean(axis=0) for name, ids in self.joints.items()}


@lru_cache
def load_body(path: Path = DATA) -> Body:
    data = np.load(path)
    return Body(
        base=data["base"].astype(np.float64),
        tris=data["tris"].astype(np.int64),
        names=tuple(str(n) for n in data["names"]),
        deltas=data["deltas"].astype(np.float64),
        joints={
            key.removeprefix("joint_"): data[key].astype(np.int64)
            for key in data.files
            if key.startswith("joint_")
        },
        uvs=data["uvs"].astype(np.float64),
        tri_uvs=data["tri_uvs"].astype(np.int64),
    )


def _split(value: float) -> tuple[float, float]:
    """0..1 'macro' value -> (low, high) target weights, MakeHuman style (0.5 is neutral)."""
    return max(0.0, 1 - 2 * value), max(0.0, 2 * value - 1)


def shape_weights(body_type: float, params: dict[str, float]) -> dict[str, float]:
    """Shape parameters -> morph weights.

    body_type: 0 feminine .. 1 masculine (blends the two base shapes).
    build, muscle: 0..1, 0.5 average. PAIRS and legs: -1..1, 0 unchanged.
    """
    g = min(1.0, max(0.0, body_type))
    weights = {"female": 1 - g, "male": g}
    thin, heavy = _split(params.get("build", 0.5))
    lean, strong = _split(params.get("muscle", 0.5))
    for sex, share in (("female", 1 - g), ("male", g)):
        weights[f"{sex}-minweight"] = share * thin
        weights[f"{sex}-maxweight"] = share * heavy
        weights[f"{sex}-minmuscle"] = share * lean
        weights[f"{sex}-maxmuscle"] = share * strong
    for pair in PAIRS:
        v = params.get(pair, 0.0)
        weights[f"{pair}-incr"] = max(0.0, v)
        weights[f"{pair}-decr"] = max(0.0, -v)
    legs = params.get("legs", 0.0)
    for leg in ("upperLeg", "lowerLeg"):
        weights[f"{leg}-incr"] = max(0.0, legs)
        weights[f"{leg}-decr"] = max(0.0, -legs)
    return weights
