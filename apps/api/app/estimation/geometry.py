"""Small, pure helpers for working with silhouette masks and landmarks."""

import math

import numpy as np

from app.estimation.types import Mask, Point


def distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def vertical_extent(mask: Mask) -> tuple[int, int] | None:
    """First and last image rows that contain any of the person."""
    rows = np.flatnonzero(mask.any(axis=1))
    if rows.size == 0:
        return None
    return int(rows[0]), int(rows[-1])


def runs(row: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True stretches in a 1-D boolean row, as [start, end) pairs."""
    padded = np.concatenate(([False], row.astype(bool), [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(edges[i]), int(edges[i + 1])) for i in range(0, len(edges), 2)]


def run_containing(mask: Mask, y: float, x: float) -> tuple[int, int] | None:
    """The stretch of person pixels on row `y` that contains column `x`."""
    row_index = round(y)
    if not 0 <= row_index < mask.shape[0]:
        return None
    for start, end in runs(mask[row_index]):
        if start <= x < end:
            return start, end
    return None


def width_at(mask: Mask, y: float, x: float, band: int = 2) -> float | None:
    """Median width (px) of the stretch containing `x`, over a few rows around `y`.

    Using a small band of rows smooths out jagged mask edges.
    """
    widths = []
    for dy in range(-band, band + 1):
        found = run_containing(mask, y + dy, x)
        if found is not None:
            widths.append(found[1] - found[0])
    if not widths:
        return None
    return float(np.median(widths))


def ellipse_perimeter(width: float, depth: float) -> float:
    """Ramanujan's approximation for the perimeter of an ellipse with these diameters."""
    a, b = width / 2, depth / 2
    return math.pi * (3 * (a + b) - math.sqrt((3 * a + b) * (a + 3 * b)))
