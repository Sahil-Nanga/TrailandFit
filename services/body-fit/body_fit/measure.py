"""Reference body measurements of a mesh (metres).

The single definition of how Trialandfit measures a body: the build script uses it to
calibrate morphs, the body-fit service to fit them, and the browser tests are checked against
values it produces.

- Circumferences: a tape measure follows the convex hull of a cross-section, so chest, waist
  and hips are convex-hull perimeters of horizontal slices through the torso, at levels found
  between the shoulder and hip joints (chest: largest below the armpits; waist: smallest;
  hips: largest around the hip joints).
- Shoulder width: distance between the shoulder joints x 1.15 (joints sit inside the shoulder
  tips), matching the photo estimator.
- Inseam: crotch (highest level where the legs have separated) down to the ankle joints.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import ConvexHull

F = NDArray[np.float64]
I = NDArray[np.int64]  # noqa: E741

JOINTS = (
    "l-shoulder",
    "r-shoulder",
    "l-upper-leg",
    "r-upper-leg",
    "l-ankle",
    "r-ankle",
    "l-eye",
    "r-eye",
    "neck",
)
DIMENSIONS = ("height", "chest", "waist", "hips", "shoulderWidth", "inseam")
SHOULDER_TIP_FACTOR = 1.15


@dataclass(frozen=True)
class Loop:
    points: F  # (n, 2) x, z

    @property
    def mean_x(self) -> float:
        return float(self.points[:, 0].mean())

    @property
    def spans_midline(self) -> bool:
        return bool(self.points[:, 0].min() < 0 < self.points[:, 0].max())

    def perimeter(self) -> float:
        if len(self.points) < 3:
            return 0.0
        try:
            return float(ConvexHull(self.points).area)  # in 2-D, "area" is the perimeter
        except Exception:
            return 0.0


def slice_loops(pos: F, tris: I, y: float) -> list[Loop]:
    """Cross-section loops of the mesh at height y."""
    ty = pos[tris, 1]  # (t, 3)
    crossing = (ty.min(axis=1) < y) & (ty.max(axis=1) > y)
    t = tris[crossing]
    if len(t) == 0:
        return []
    edges = np.stack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]], axis=1)  # (t, 3, 2)
    d = pos[edges, 1] - y  # (t, 3, 2)
    cut = d[..., 0] * d[..., 1] < 0  # (t, 3)
    two = cut.sum(axis=1) == 2
    edges, d, cut = edges[two], d[two], cut[two]
    lo, hi = np.sort(edges, axis=2)[..., 0], np.sort(edges, axis=2)[..., 1]
    n = len(pos)
    keys = lo * n + hi  # (t, 3) unique id per mesh edge
    # Each triangle contributes one segment between its two cut edges.
    seg = keys[cut].reshape(-1, 2)
    uniq, inverse = np.unique(seg, return_inverse=True)
    inverse = inverse.reshape(-1, 2)
    graph = coo_matrix(
        (np.ones(len(inverse)), (inverse[:, 0], inverse[:, 1])), shape=(len(uniq), len(uniq))
    )
    count, labels = connected_components(graph, directed=False)
    # Intersection point of every cut edge.
    a, b = pos[uniq // n], pos[uniq % n]
    s = (y - a[:, 1]) / (b[:, 1] - a[:, 1])
    points = np.stack(
        [a[:, 0] + s * (b[:, 0] - a[:, 0]), a[:, 2] + s * (b[:, 2] - a[:, 2])], axis=1
    )
    loops = [Loop(points[labels == k]) for k in range(count)]
    return [loop for loop in loops if len(loop.points) >= 8]


def torso_circumference(pos: F, tris: I, y: float) -> float:
    loops = slice_loops(pos, tris, y)
    if not loops:
        return 0.0
    return min(loops, key=lambda loop: abs(loop.mean_x)).perimeter()  # loop around the midline


def joint_positions(pos: F, joint_vertices: dict[str, I]) -> dict[str, F]:
    return {name: pos[ids].mean(axis=0) for name, ids in joint_vertices.items()}


def _crotch(pos: F, tris: I, top: float, bottom: float) -> float:
    """Highest level where no cross-section spans the midline (the legs have separated).
    Checking the midline, not the number of loops, ignores the hands hanging at hip height."""

    def separated(y: float) -> bool:
        loops = slice_loops(pos, tris, y)
        return bool(loops) and not any(loop.spans_midline for loop in loops)

    ys = np.linspace(top, bottom, 24)
    hit = next((i for i, y in enumerate(ys) if separated(float(y))), None)
    if hit is None or hit == 0:
        return top
    hi, lo = float(ys[hit - 1]), float(ys[hit])  # joined at hi, separated at lo
    for _ in range(10):
        mid = (hi + lo) / 2
        if separated(mid):
            lo = mid
        else:
            hi = mid
    return lo


def measure(pos: F, tris: I, joints: dict[str, F], samples: int = 12) -> dict[str, float]:
    """Body measurements in metres for vertex positions `pos` (y up, any floor level)."""
    floor = float(pos[:, 1].min())
    height = float(pos[:, 1].max()) - floor
    shoulder_y = float((joints["l-shoulder"][1] + joints["r-shoulder"][1]) / 2)
    hip_y = float((joints["l-upper-leg"][1] + joints["r-upper-leg"][1]) / 2)
    torso = shoulder_y - hip_y

    def search(lo: float, hi: float, pick: str) -> float:
        values = [torso_circumference(pos, tris, float(y)) for y in np.linspace(lo, hi, samples)]
        values = [v for v in values if v > 0]
        if not values:
            return 0.0
        return max(values) if pick == "max" else min(values)

    # Chest starts below the armpits: higher slices still include where the arms attach.
    chest = search(shoulder_y - 0.45 * torso, shoulder_y - 0.20 * torso, "max")
    waist = search(hip_y + 0.35 * torso, hip_y + 0.65 * torso, "min")
    hips = search(hip_y - 0.20 * torso, hip_y + 0.15 * torso, "max")
    crotch = _crotch(pos, tris, hip_y + 0.05, floor + 0.3 * height)
    ankle_y = float((joints["l-ankle"][1] + joints["r-ankle"][1]) / 2)
    shoulder_width = (
        float(np.linalg.norm(joints["l-shoulder"] - joints["r-shoulder"])) * SHOULDER_TIP_FACTOR
    )
    return {
        "height": height,
        "chest": chest,
        "waist": waist,
        "hips": hips,
        "shoulderWidth": shoulder_width,
        "inseam": crotch - ankle_y,
    }


# --- fast path used while fitting -----------------------------------------------------------


@dataclass(frozen=True)
class Levels:
    """Where chest, waist and hips were found, as fractions of the hip-to-shoulder distance."""

    chest: float
    waist: float
    hips: float


def find_levels(pos: F, tris: I, joints: dict[str, F], samples: int = 12) -> Levels:
    shoulder_y = float((joints["l-shoulder"][1] + joints["r-shoulder"][1]) / 2)
    hip_y = float((joints["l-upper-leg"][1] + joints["r-upper-leg"][1]) / 2)
    torso = shoulder_y - hip_y

    def best(lo: float, hi: float, pick: str) -> float:
        fracs = np.linspace(lo, hi, samples)
        values = [torso_circumference(pos, tris, hip_y + f * torso) for f in fracs]
        scored = [(v, f) for v, f in zip(values, fracs, strict=True) if v > 0]
        choose = max if pick == "max" else min
        return float(choose(scored)[1])

    # Same ranges as measure(), expressed from the hips up.
    return Levels(
        chest=best(0.55, 0.80, "max"), waist=best(0.35, 0.65, "min"), hips=best(-0.20, 0.15, "max")
    )


def measure_at(pos: F, tris: I, joints: dict[str, F], levels: Levels) -> dict[str, float]:
    """Height, circumferences at fixed levels, and shoulder width. Cheap enough to call per step."""
    shoulder_y = float((joints["l-shoulder"][1] + joints["r-shoulder"][1]) / 2)
    hip_y = float((joints["l-upper-leg"][1] + joints["r-upper-leg"][1]) / 2)
    torso = shoulder_y - hip_y
    return {
        "height": float(pos[:, 1].max() - pos[:, 1].min()),
        "chest": torso_circumference(pos, tris, hip_y + levels.chest * torso),
        "waist": torso_circumference(pos, tris, hip_y + levels.waist * torso),
        "hips": torso_circumference(pos, tris, hip_y + levels.hips * torso),
        "shoulderWidth": float(np.linalg.norm(joints["l-shoulder"] - joints["r-shoulder"]))
        * SHOULDER_TIP_FACTOR,
    }
