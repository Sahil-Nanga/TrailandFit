"""Download the pinned MediaPipe models into models/ and verify their checksums.

- Face landmarker: lines the face up for the photo likeness.
- Pose landmarker: finds the person in a shop's model photo, to crop out the garment.

Run from services/body-fit:  uv run python -m scripts.download_models
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS = (
    (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
        "face_landmarker.task",
    ),
    (
        # Same model and checksum as apps/api.
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
        "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b",
        "pose_landmarker_heavy.task",
    ),
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url: str, sha256: str, target: Path) -> bool:
    if target.exists() and _sha256(target) == sha256:
        print(f"Model already present: {target}")
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".part")
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, tmp)
    if _sha256(tmp) != sha256:
        tmp.unlink()
        print(f"Checksum mismatch for {target.name}; refusing to use it.", file=sys.stderr)
        return False
    tmp.replace(target)
    print(f"Saved {target}")
    return True


def main() -> int:
    results = [download(url, sha, MODELS_DIR / name) for url, sha, name in MODELS]
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
