"""Turn a validated body scan into measurements.

Scale comes from the user's height: the silhouette's pixel height maps to `height_cm`.
Lengths use landmarks. Circumferences use the silhouette width at a body level plus a depth,
either measured from the side photo or assumed from typical body proportions, and treat the
cross-section as an ellipse. Confidence reflects landmark visibility and the method used.

Not estimated from photos: weight, and neck (hair, beards and collars made it unreliable in
testing; revisit once a benchmark set exists). Users enter those manually.
"""

from app.estimation.geometry import (
    distance,
    ellipse_perimeter,
    run_containing,
    vertical_extent,
    width_at,
)
from app.estimation.types import BodyScan, Estimate, Landmark, Mask, Point

# Where each circumference is taken, as a fraction of shoulder-to-hip distance from the
# shoulder line (negative = above it). Hips are measured just below the hip joints.
CHEST_LEVEL = 0.30
WAIST_LEVEL = 0.70
HIPS_LEVEL = 1.05
THIGH_LEVEL = 0.30  # fraction of hip-to-knee distance below the hips

# Wrist-to-fingertip length as a fraction of the forearm (elbow to wrist); about 19 vs 26 cm.
HAND_LENGTH = 0.75

# How far below the hip joints (fraction of hip-to-knee) a leg gap still counts as the crotch.
# Only trusted when the feet are at least as far apart as the hip joints; with feet together
# the thighs usually touch and the first gap appears well below the real crotch.
MAX_CROTCH_DROP = 0.45

# Typical depth / width ratios, used only without a side photo.
ASSUMED_DEPTH_RATIO = {"chest": 0.70, "waist": 0.78, "hips": 0.72, "thigh": 0.95}

# Landmarks sit at joint centres; shoulder tips are a little further out.
SHOULDER_TIP_FACTOR = 1.15

# Below this many pixels of body height, each pixel covers so much of the body that edge
# errors matter; confidence is scaled down proportionally (never below half).
FULL_RESOLUTION_PX = 600
MIN_RESOLUTION_FACTOR = 0.5

# Upper limits on confidence for each method; multiplied by landmark visibility.
CONFIDENCE_CAP: dict[str, float | tuple[float, float]] = {
    "shoulder_width_cm": 0.75,
    "sleeve_cm": 0.70,
    "inseam_cm": 0.70,
    "chest_cm": (0.45, 0.70),  # (front only, with side photo)
    "waist_cm": (0.50, 0.75),
    "hips_cm": (0.50, 0.75),
    "thigh_cm": (0.35, 0.55),
}


def _mid(a: Point, b: Point) -> Point:
    return Point((a.x + b.x) / 2, (a.y + b.y) / 2, min(a.visibility, b.visibility))


def _arm_x(arm: tuple[Point, Point, Point], y: float) -> float | None:
    """Where the arm's centre line crosses row `y` (None if the arm is not at that height).

    The line runs shoulder -> elbow -> wrist and on through the hand, which has no landmark
    of its own; hands often hang at hip level and must not be measured as hips.
    """
    shoulder, elbow, wrist = arm
    hand_tip = Point(
        wrist.x + HAND_LENGTH * (wrist.x - elbow.x),
        wrist.y + HAND_LENGTH * (wrist.y - elbow.y),
        wrist.visibility,
    )
    for a, b in ((shoulder, elbow), (elbow, wrist), (wrist, hand_tip)):
        lo, hi = sorted((a.y, b.y))
        if lo <= y <= hi and hi > lo:
            return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)
    return None


def _torso_width(
    mask: Mask,
    start_y: float,
    end_y: float,
    center_x: float,
    arms: tuple[tuple[Point, Point, Point], tuple[Point, Point, Point]],
) -> float | None:
    """Torso width on the first row from start_y to end_y where it is clear of both arms.

    Upper arms often touch the chest in a silhouette; measuring there would include them.
    """
    step = 1 if end_y >= start_y else -1
    for y in range(round(start_y), round(end_y) + step, step):
        torso = run_containing(mask, y, center_x)
        if torso is None:
            continue
        # Each arm must be outside the torso stretch. (No assumption about which side is which:
        # MediaPipe's LEFT is the person's left, i.e. the image's right in a front photo.)
        arm_xs = (_arm_x(arm, y) for arm in arms)
        if all(x is None or not torso[0] <= x < torso[1] for x in arm_xs):
            return width_at(mask, y, center_x, band=1)
    return None


def _cap(field: str, has_side: bool) -> float:
    cap = CONFIDENCE_CAP[field]
    if isinstance(cap, tuple):
        return cap[1] if has_side else cap[0]
    return cap


class _Side:
    """Depths (in cm) at the same body levels, measured on the side photo."""

    def __init__(self, scan: BodyScan, height_cm: float) -> None:
        extent = vertical_extent(scan.mask)
        if extent is None:
            raise ValueError("validate_side must run before measuring")
        self._scan = scan
        self._cm_per_px = height_cm / (extent[1] - extent[0])
        # Use whichever side of the body faces the camera.
        left_vis = scan.point(Landmark.LEFT_SHOULDER).visibility
        right_vis = scan.point(Landmark.RIGHT_SHOULDER).visibility
        near = "LEFT" if left_vis >= right_vis else "RIGHT"
        self._shoulder = scan.point(Landmark[f"{near}_SHOULDER"])
        self._hip = scan.point(Landmark[f"{near}_HIP"])
        self._knee = scan.point(Landmark[f"{near}_KNEE"])

    def depth(self, part: str) -> float | None:
        s, h = self._shoulder, self._hip
        torso = h.y - s.y
        level = {
            "chest": s.y + CHEST_LEVEL * torso,
            "waist": s.y + WAIST_LEVEL * torso,
            "hips": s.y + HIPS_LEVEL * torso,
            "thigh": h.y + THIGH_LEVEL * (self._knee.y - h.y),
        }[part]
        x = (s.x + h.x) / 2 if part != "thigh" else (h.x + self._knee.x) / 2
        width = width_at(self._scan.mask, level, x)
        return None if width is None else width * self._cm_per_px


def measure(front: BodyScan, side: BodyScan | None, height_cm: float) -> Estimate:
    extent = vertical_extent(front.mask)
    if extent is None:
        raise ValueError("validate_front must run before measuring")
    person_px = extent[1] - extent[0]
    cm_per_px = height_cm / person_px
    resolution = max(MIN_RESOLUTION_FACTOR, min(1.0, person_px / FULL_RESOLUTION_PX))
    p = front.point
    values: dict[str, float] = {}
    confidence: dict[str, float] = {}
    notes: list[str] = []
    side_depths = _Side(side, height_cm) if side is not None else None

    def record(field: str, value_cm: float, visibility: float) -> None:
        values[field] = round(value_cm, 1)
        confidence[field] = round(
            max(0.0, min(1.0, visibility)) * _cap(field, side is not None) * resolution, 2
        )

    ls, rs = p(Landmark.LEFT_SHOULDER), p(Landmark.RIGHT_SHOULDER)
    lh, rh = p(Landmark.LEFT_HIP), p(Landmark.RIGHT_HIP)
    shoulders, hips = _mid(ls, rs), _mid(lh, rh)
    torso = hips.y - shoulders.y
    center_x = (shoulders.x + hips.x) / 2

    # Shoulder width.
    record(
        "shoulder_width_cm",
        distance(ls, rs) * cm_per_px * SHOULDER_TIP_FACTOR,
        min(ls.visibility, rs.visibility),
    )

    # Sleeve: shoulder -> elbow -> wrist on the better-visible arm.
    arms = (
        (p(Landmark.LEFT_SHOULDER), p(Landmark.LEFT_ELBOW), p(Landmark.LEFT_WRIST)),
        (p(Landmark.RIGHT_SHOULDER), p(Landmark.RIGHT_ELBOW), p(Landmark.RIGHT_WRIST)),
    )
    s, e, w = max(arms, key=lambda arm: min(pt.visibility for pt in arm))
    record(
        "sleeve_cm",
        (distance(s, e) + distance(e, w)) * cm_per_px,
        min(s.visibility, e.visibility, w.visibility),
    )

    # Inseam: from where the legs split (gap at the body's centre line) down to the ankles.
    ankles = _mid(p(Landmark.LEFT_ANKLE), p(Landmark.RIGHT_ANKLE))
    crotch_y = None
    cx = round(hips.x)
    for y in range(round(hips.y), round(ankles.y)):
        if not front.mask[y, cx]:
            crotch_y = y
            break
    knees_y = (p(Landmark.LEFT_KNEE).y + p(Landmark.RIGHT_KNEE).y) / 2
    # The crotch sits a little below the hip joints; a gap found much lower means the thighs
    # touch, and measuring from there would give a much too short inseam.
    left_ankle, right_ankle = p(Landmark.LEFT_ANKLE), p(Landmark.RIGHT_ANKLE)
    feet_apart = abs(left_ankle.x - right_ankle.x) >= abs(lh.x - rh.x)
    if (
        feet_apart
        and crotch_y is not None
        and crotch_y < hips.y + MAX_CROTCH_DROP * (knees_y - hips.y)
    ):
        record("inseam_cm", (ankles.y - crotch_y) * cm_per_px, ankles.visibility)
    else:
        notes.append("Stand with your feet slightly apart so we can measure your inseam.")

    # Circumferences.
    knee = _mid(p(Landmark.LEFT_KNEE), p(Landmark.RIGHT_KNEE))
    left_leg_x = (lh.x + p(Landmark.LEFT_KNEE).x) / 2
    right_leg_x = (rh.x + p(Landmark.RIGHT_KNEE).x) / 2
    levels = {
        "chest": (shoulders.y + CHEST_LEVEL * torso, center_x, shoulders.visibility),
        "waist": (
            shoulders.y + WAIST_LEVEL * torso,
            center_x,
            min(shoulders.visibility, hips.visibility),
        ),
        "hips": (shoulders.y + HIPS_LEVEL * torso, center_x, hips.visibility),
        "thigh": (
            hips.y + THIGH_LEVEL * (knee.y - hips.y),
            left_leg_x,
            min(hips.visibility, knee.visibility),
        ),
    }
    # How far below each torso level we may look for a row that is clear of the arms.
    search_to = {"chest": 0.5, "waist": 0.85, "hips": 1.15}
    skipped: list[str] = []
    for part, (level_y, x, visibility) in levels.items():
        if part in search_to:
            width_px = _torso_width(
                front.mask, level_y, shoulders.y + search_to[part] * torso, x, arms
            )
            if width_px is None:
                skipped.append(part)
                continue
        else:
            width_px = width_at(front.mask, level_y, x)
            if width_px is None:
                continue
        if part == "thigh":
            leg = run_containing(front.mask, level_y, x)
            if leg is None or leg[0] <= right_leg_x < leg[1]:
                continue  # legs touch at this height; the width would cover both thighs
        width_cm = width_px * cm_per_px
        depth_cm = side_depths.depth(part) if side_depths is not None else None
        if depth_cm is None:
            depth_cm = width_cm * ASSUMED_DEPTH_RATIO[part]
        record(f"{part}_cm", ellipse_perimeter(width_cm, depth_cm), visibility)

    if skipped:
        notes.append(
            "Hold your arms a little further from your body so we can measure your "
            + " and ".join(skipped)
            + "."
        )
    if resolution < 1.0:
        notes.append("Use a sharper, higher-resolution photo for more accurate numbers.")
    if side is None:
        notes.append("Add a side photo for more accurate chest, waist and hip numbers.")
    return Estimate(values=values, confidence=confidence, notes=notes)
