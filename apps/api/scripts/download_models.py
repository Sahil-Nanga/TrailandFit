"""Download the pinned MediaPipe pose model into models/ and verify its checksum.

Run from apps/api:  uv run python -m scripts.download_models
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
)
MODEL_SHA256 = "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b"
TARGET = Path(__file__).resolve().parent.parent / "models" / "pose_landmarker_heavy.task"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if TARGET.exists() and _sha256(TARGET) == MODEL_SHA256:
        print(f"Model already present: {TARGET}")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    tmp = TARGET.with_suffix(".part")
    print(f"Downloading {MODEL_URL}")
    urllib.request.urlretrieve(MODEL_URL, tmp)
    if _sha256(tmp) != MODEL_SHA256:
        tmp.unlink()
        print("Checksum mismatch; refusing to use the downloaded file.", file=sys.stderr)
        return 1
    tmp.replace(TARGET)
    print(f"Saved {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
