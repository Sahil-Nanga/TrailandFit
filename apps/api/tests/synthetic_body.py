"""Synthetic body scans: a hand-built silhouette with known dimensions, no real photos.

The figure stands 800 px tall (rows 100..899) in a 1000 x 600 image, arms held slightly
away from the body and feet apart, so every measurement has a known expected value.
"""

import math
from dataclasses import dataclass, replace

import numpy as np

from app.estimation.types import BodyScan, Landmark, Point

H, W = 1000, 600
TOP, BOTTOM = 100, 899

SHOULDER_Y, HIP_Y = 250, 470
CHEST_Y = SHOULDER_Y + 0.30 * (HIP_Y - SHOULDER_Y)
WAIST_Y = SHOULDER_Y + 0.70 * (HIP_Y - SHOULDER_Y)
HIPS_Y = SHOULDER_Y + 1.05 * (HIP_Y - SHOULDER_Y)
CROTCH_Y = 520
KNEE_Y, ANKLE_Y = 690, 870

CHEST_W, WAIST_W, HIPS_W = 160, 130, 170
LEG_W = 70


@dataclass(frozen=True)
class Figure:
    """Knobs for building variations of the standard figure."""

    arms_touching: bool = False
    hands_at_hips: bool = False  # arms hang lower, hands overlapping the hip outline
    feet_together: bool = False
    shoulder_tilt: float = 0.0


def _disk(mask: np.ndarray, cx: float, cy: float, r: float) -> None:
    y0, y1 = max(0, int(cy - r)), min(mask.shape[0], int(cy + r) + 1)
    x0, x1 = max(0, int(cx - r)), min(mask.shape[1], int(cx + r) + 1)
    yy, xx = np.ogrid[y0:y1, x0:x1]
    mask[y0:y1, x0:x1] |= (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def _segment(mask: np.ndarray, a: tuple[float, float], b: tuple[float, float], r: float) -> None:
    steps = int(math.dist(a, b)) + 1
    for t in np.linspace(0, 1, steps):
        _disk(mask, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)


def _torso_half_width(y: int) -> float:
    # Piecewise-linear torso outline through chest, waist and hip widths.
    points = [
        (240, 75),
        (CHEST_Y, CHEST_W / 2),
        (WAIST_Y, WAIST_W / 2),
        (HIPS_Y, HIPS_W / 2),
        (CROTCH_Y, 85),
    ]
    ys, ws = zip(*points, strict=True)
    return float(np.interp(y, ys, ws))


STANDARD = Figure()


def front_scan(figure: Figure = STANDARD) -> BodyScan:
    mask = np.zeros((H, W), dtype=bool)
    cx = W // 2
    # Head (top at row 100) and neck.
    yy, xx = np.ogrid[:H, :W]
    mask |= ((xx - cx) / 45) ** 2 + ((yy - 160) / 60) ** 2 <= 1
    mask[215:245, cx - 20 : cx + 20] = True
    # Torso.
    for y in range(240, CROTCH_Y):
        half = _torso_half_width(y)
        mask[y, round(cx - half) : round(cx + half)] = True
    # Legs, feet apart unless asked otherwise.
    offset = 30 if figure.feet_together else 45
    for side in (-1, 1):
        leg_x = cx + side * offset
        mask[CROTCH_Y - 40 : BOTTOM + 1, leg_x - LEG_W // 2 : leg_x + LEG_W // 2] = True
    # Arms: shoulder -> elbow -> wrist.
    elbow_dx = 75 if figure.arms_touching else 110
    elbow_y, wrist_y, wrist_dx = 400, 530, elbow_dx + 20
    if figure.hands_at_hips:
        elbow_dx, elbow_y, wrist_y, wrist_dx = 100, 350, 440, 95
    for side in (-1, 1):
        shoulder = (cx + side * 70, SHOULDER_Y)
        elbow = (cx + side * elbow_dx, elbow_y)
        wrist = (cx + side * wrist_dx, wrist_y)
        hand_tip = (wrist[0] + 0.5 * (wrist[0] - elbow[0]), wrist[1] + 0.5 * (wrist[1] - elbow[1]))
        _segment(mask, shoulder, elbow, 15)
        _segment(mask, elbow, wrist, 13)
        _segment(mask, wrist, hand_tip, 14)  # the hand, which has no landmark of its own

    tilt = figure.shoulder_tilt
    # Facing the camera, the person's LEFT side is on the image's right (as MediaPipe reports).
    lm = {
        Landmark.NOSE: Point(cx, 165, 0.99),
        Landmark.RIGHT_EAR: Point(cx - 45, 170, 0.99),
        Landmark.LEFT_EAR: Point(cx + 45, 170, 0.99),
        Landmark.RIGHT_SHOULDER: Point(cx - 70, SHOULDER_Y - tilt, 0.99),
        Landmark.LEFT_SHOULDER: Point(cx + 70, SHOULDER_Y + tilt, 0.99),
        Landmark.RIGHT_ELBOW: Point(cx - elbow_dx, elbow_y, 0.99),
        Landmark.LEFT_ELBOW: Point(cx + elbow_dx, elbow_y, 0.99),
        Landmark.RIGHT_WRIST: Point(cx - wrist_dx, wrist_y, 0.99),
        Landmark.LEFT_WRIST: Point(cx + wrist_dx, wrist_y, 0.99),
        Landmark.RIGHT_HIP: Point(cx - 45, HIP_Y, 0.99),
        Landmark.LEFT_HIP: Point(cx + 45, HIP_Y, 0.99),
        Landmark.RIGHT_KNEE: Point(cx - offset, KNEE_Y, 0.99),
        Landmark.LEFT_KNEE: Point(cx + offset, KNEE_Y, 0.99),
        Landmark.RIGHT_ANKLE: Point(cx - offset, ANKLE_Y, 0.99),
        Landmark.LEFT_ANKLE: Point(cx + offset, ANKLE_Y, 0.99),
        Landmark.RIGHT_HEEL: Point(cx - offset, 890, 0.99),
        Landmark.LEFT_HEEL: Point(cx + offset, 890, 0.99),
    }
    return BodyScan(landmarks=lm, mask=mask)


CHEST_DEPTH, WAIST_DEPTH, HIPS_DEPTH = 120, 100, 125


def side_scan() -> BodyScan:
    """Same person seen side-on: same height, torso depths instead of widths."""
    mask = np.zeros((H, W), dtype=bool)
    cx = W // 2
    yy, xx = np.ogrid[:H, :W]
    mask |= ((xx - cx) / 50) ** 2 + ((yy - 160) / 60) ** 2 <= 1
    mask[215:245, cx - 25 : cx + 25] = True
    points = [
        (240, 50),
        (CHEST_Y, CHEST_DEPTH / 2),
        (WAIST_Y, WAIST_DEPTH / 2),
        (HIPS_Y, HIPS_DEPTH / 2),
        (CROTCH_Y, 55),
    ]
    ys, ws = zip(*points, strict=True)
    for y in range(240, CROTCH_Y):
        half = float(np.interp(y, ys, ws))
        mask[y, round(cx - half) : round(cx + half)] = True
    mask[CROTCH_Y - 40 : BOTTOM + 1, cx - 40 : cx + 40] = True
    near = {
        Landmark.LEFT_SHOULDER: Point(cx, SHOULDER_Y, 0.95),
        Landmark.LEFT_HIP: Point(cx, HIP_Y, 0.95),
        Landmark.LEFT_KNEE: Point(cx, KNEE_Y, 0.95),
        Landmark.LEFT_ANKLE: Point(cx, ANKLE_Y, 0.95),
        Landmark.LEFT_EAR: Point(cx, 170, 0.95),
    }
    far = {
        Landmark[k.name.replace("LEFT", "RIGHT")]: replace(v, x=v.x + 8, visibility=0.3)
        for k, v in near.items()
    }
    rest = {lm: Point(cx, 400, 0.4) for lm in Landmark if lm not in near and lm not in far}
    return BodyScan(landmarks={**rest, **near, **far}, mask=mask)


def shifted(scan: BodyScan, dy: int) -> BodyScan:
    """Move the whole figure up (negative) or down (positive) in the frame."""
    mask = np.roll(scan.mask, dy, axis=0)
    if dy < 0:
        mask[dy:] = False
    lm = {k: replace(v, y=v.y + dy) for k, v in scan.landmarks.items()}
    return BodyScan(landmarks=lm, mask=mask)


def shrunk(scan: BodyScan, factor: int) -> BodyScan:
    """Make the figure `factor` times smaller (as if standing far away)."""
    small = scan.mask[::factor, ::factor]
    mask = np.zeros_like(scan.mask)
    mask[: small.shape[0], : small.shape[1]] = small
    mask = np.roll(mask, (H - small.shape[0]) // 2, axis=0)
    lm = {
        k: replace(v, x=v.x / factor, y=v.y / factor + (H - small.shape[0]) // 2)
        for k, v in scan.landmarks.items()
    }
    return BodyScan(landmarks=lm, mask=mask)


def with_visibility(scan: BodyScan, landmark: Landmark, visibility: float) -> BodyScan:
    lm = dict(scan.landmarks)
    lm[landmark] = replace(lm[landmark], visibility=visibility)
    return BodyScan(landmarks=lm, mask=scan.mask)


def downscaled(scan: BodyScan, factor: int) -> BodyScan:
    """The same photo at lower resolution (fewer pixels, same framing)."""
    mask = scan.mask[::factor, ::factor]
    lm = {k: replace(v, x=v.x / factor, y=v.y / factor) for k, v in scan.landmarks.items()}
    return BodyScan(landmarks=lm, mask=mask)
