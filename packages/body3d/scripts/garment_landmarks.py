"""Where garments sit on the base body: writes src/garmentLandmarks.json.

    uv run --directory services/body-fit python ../../packages/body3d/scripts/garment_landmarks.py

Garments are made from the body's own surface (see GarmentModel.tsx), so all they need is a few
heights on the neutral base body and a way to tell the arms from the torso. Below the armpits
the arms are separate cross-sections, so at each height anything farther out than the torso's
cross-section is arm. Re-run this after rebuilding body.glb.
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "body-fit"))

from body_fit.body import load_body  # noqa: E402
from body_fit.measure import _crotch, find_levels, slice_loops  # noqa: E402

STEP = 0.01  # metres between torso width samples
OUT = Path(__file__).resolve().parents[1] / "src" / "garmentLandmarks.json"


def main() -> None:
    body = load_body()
    pos, tris = body.base, body.tris
    joints = body.joint_positions(pos)
    hip_joint_y = float((joints["l-upper-leg"][1] + joints["r-upper-leg"][1]) / 2)
    shoulder_y = float((joints["l-shoulder"][1] + joints["r-shoulder"][1]) / 2)
    neck_y = float(joints["neck"][1])
    torso = shoulder_y - hip_joint_y
    levels = find_levels(pos, tris, joints)
    crotch = _crotch(pos, tris, hip_joint_y + 0.05, 0.3 * float(pos[:, 1].max()))

    y0 = round(crotch + STEP, 2)
    half_widths: list[float] = []
    arm_perimeters: list[tuple[float, float]] = []  # (y, perimeter) of the left arm
    for y in np.arange(y0, neck_y + STEP / 2, STEP):
        loops = slice_loops(pos, tris, float(y))
        torso_loops = [loop for loop in loops if loop.spans_midline]
        half = float(np.abs(torso_loops[0].points[:, 0]).max()) if torso_loops else 0.0
        half_widths.append(round(half, 4))
        arms = [loop for loop in loops if not loop.spans_midline and loop.mean_x > 0.12]
        if len(arms) == 1:
            arm_perimeters.append((float(y), arms[0].perimeter()))

    # Wrist: going down from below the elbow, the first narrowing before the hand widens again.
    # (Lower slices cut through the fingers, so the overall narrowest is a fingertip.)
    arm_perimeters.sort(reverse=True)
    wrist = next(
        y
        for i, (y, perimeter) in enumerate(arm_perimeters[1:-1], start=1)
        if y < shoulder_y - 0.20
        and perimeter <= arm_perimeters[i - 1][1]
        and perimeter < arm_perimeters[i + 1][1]
    )

    landmarks = {
        "source": "packages/body3d/scripts/garment_landmarks.py (neutral base body, metres)",
        "neckY": round(neck_y, 4),
        "shoulderY": round(shoulder_y, 4),
        "chestY": round(hip_joint_y + levels.chest * torso, 4),
        "waistY": round(hip_joint_y + levels.waist * torso, 4),
        "hipJointY": round(hip_joint_y, 4),
        "crotchY": round(crotch, 4),
        "kneeY": round(float((joints["l-ankle"][1] + hip_joint_y) / 2), 4),
        "ankleY": round(float((joints["l-ankle"][1] + joints["r-ankle"][1]) / 2), 4),
        "wristY": round(wrist, 4),
        "torsoHalfWidth": {"y0": y0, "step": STEP, "values": half_widths},
    }
    OUT.write_text(json.dumps(landmarks, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
