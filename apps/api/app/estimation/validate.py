"""Photo checks. Each failure raises RetakeError with a message the user can act on."""

from app.estimation.geometry import distance, run_containing, vertical_extent
from app.estimation.types import BodyScan, Landmark, RetakeError

MIN_VISIBILITY = 0.5
MIN_FILL = 0.5  # the person should be at least half the image height
EDGE_MARGIN = 2  # pixels

# Facing the camera, shoulder width is roughly a quarter of body height; side-on it shrinks.
FACING_RATIO = 0.12
MAX_SHOULDER_TILT = 0.15

_CORE = (
    Landmark.NOSE,
    Landmark.LEFT_SHOULDER,
    Landmark.RIGHT_SHOULDER,
    Landmark.LEFT_HIP,
    Landmark.RIGHT_HIP,
    Landmark.LEFT_ANKLE,
    Landmark.RIGHT_ANKLE,
)


def _check_framing(scan: BodyScan, which: str) -> int:
    extent = vertical_extent(scan.mask)
    if extent is None:
        raise RetakeError("no_person", f"We couldn't find a person in the {which} photo.")
    top, bottom = extent
    if top <= EDGE_MARGIN or bottom >= scan.height_px - 1 - EDGE_MARGIN:
        raise RetakeError(
            "cropped",
            f"Your head or feet are cut off in the {which} photo. Step back so there is a "
            "little space above your head and below your feet.",
        )
    person_height = bottom - top
    if person_height < MIN_FILL * scan.height_px:
        raise RetakeError(
            "too_far",
            f"You're too far away in the {which} photo. Move closer so you fill most of "
            "the frame, head to feet.",
        )
    return person_height


def _side_visible(scan: BodyScan, side: str, parts: tuple[str, ...]) -> bool:
    return all(
        scan.point(Landmark[f"{side}_{part}"]).visibility >= MIN_VISIBILITY for part in parts
    )


def validate_front(scan: BodyScan) -> None:
    if any(scan.point(lm).visibility < MIN_VISIBILITY for lm in _CORE):
        # Shoulder and hip hidden on one side only: they are standing side-on.
        upper = ("SHOULDER", "HIP")
        if _side_visible(scan, "LEFT", upper) != _side_visible(scan, "RIGHT", upper):
            raise RetakeError("not_facing", "Face the camera straight on for the front photo.")
        raise RetakeError(
            "body_not_visible",
            "Make sure your whole body is visible in the front photo, from head to feet.",
        )
    person_height = _check_framing(scan, "front")

    left, right = scan.point(Landmark.LEFT_SHOULDER), scan.point(Landmark.RIGHT_SHOULDER)
    shoulder_width = distance(left, right)
    if shoulder_width / person_height < FACING_RATIO:
        raise RetakeError("not_facing", "Face the camera straight on for the front photo.")
    if abs(left.y - right.y) / shoulder_width > MAX_SHOULDER_TILT:
        raise RetakeError("not_straight", "Stand up straight with your shoulders level.")

    # Arms pressed against the body make the waist look wider than it is.
    elbows = (scan.point(Landmark.LEFT_ELBOW), scan.point(Landmark.RIGHT_ELBOW))
    if all(e.visibility >= MIN_VISIBILITY for e in elbows):
        hips_y = (scan.point(Landmark.LEFT_HIP).y + scan.point(Landmark.RIGHT_HIP).y) / 2
        shoulders_y = (left.y + right.y) / 2
        center_x = (left.x + right.x) / 2
        waist = run_containing(scan.mask, shoulders_y + 0.7 * (hips_y - shoulders_y), center_x)
        lo, hi = sorted(e.x for e in elbows)
        if waist is not None and (waist[0] <= lo or waist[1] > hi):
            raise RetakeError(
                "arms_touching",
                "Hold your arms slightly away from your body so we can see your waist.",
            )


def validate_side(scan: BodyScan) -> None:
    full = ("SHOULDER", "HIP", "ANKLE")
    if not (_side_visible(scan, "LEFT", full) or _side_visible(scan, "RIGHT", full)):
        raise RetakeError(
            "body_not_visible",
            "Make sure your whole body is visible in the side photo, from head to feet.",
        )
    person_height = _check_framing(scan, "side")
    shoulder_width = distance(
        scan.point(Landmark.LEFT_SHOULDER), scan.point(Landmark.RIGHT_SHOULDER)
    )
    if shoulder_width / person_height >= FACING_RATIO:
        raise RetakeError("not_side", "For the side photo, turn so your side faces the camera.")
