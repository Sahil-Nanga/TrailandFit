import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
from fastapi import FastAPI
from PIL import Image

from app.api import photos as photos_api
from app.core.config import Settings, get_settings
from app.estimation.types import BodyScan, RGBImage
from tests import synthetic_body as body
from tests.conftest import TokenFactory

URL = "/v1/photos/estimate"


class RecordingDetector:
    """Returns the synthetic front/side scans and remembers the image sizes it was given."""

    def __init__(self, *scans: BodyScan | None) -> None:
        self._scans = list(scans)
        self.shapes: list[tuple[int, ...]] = []

    def detect(self, image: RGBImage) -> BodyScan | None:
        self.shapes.append(image.shape)
        return self._scans.pop(0)


def _image(fmt: str = "JPEG", size: tuple[int, int] = (600, 1000), **save: Any) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 200, 200)).save(buffer, format=fmt, **save)
    return buffer.getvalue()


def _form(height: str = "175", consent: str = "true") -> dict[str, str]:
    return {"height_cm": height, "consent": consent}


@pytest.fixture(autouse=True)
def _fresh_rate_limiter() -> Iterator[None]:
    photos_api._limiter = None
    yield
    photos_api._limiter = None


@pytest.fixture
def auth(make_token: TokenFactory) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub='photo-user')}"}


@pytest.fixture
def use_detector(app: FastAPI) -> Any:
    def _use(detector: RecordingDetector) -> RecordingDetector:
        app.dependency_overrides[photos_api.get_pose_detector] = lambda: detector
        return detector

    return _use


async def test_front_photo_estimate(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    use_detector(RecordingDetector(body.front_scan()))
    response = await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", _image(), "image/jpeg")}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["measurements"]["height_cm"] == 175
    assert result["measurements"]["weight_kg"] is None
    assert 25 < result["measurements"]["shoulder_width_cm"] < 50
    assert set(result["confidence"]) <= set(result["measurements"])
    assert "height_cm" not in result["confidence"]  # the user gave us height
    assert any("side photo" in note for note in result["notes"])


async def test_front_and_side_photos(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    detector = use_detector(RecordingDetector(body.front_scan(), body.side_scan()))
    response = await client.post(
        URL,
        headers=auth,
        data=_form(),
        files={
            "front_photo": ("f.jpg", _image(), "image/jpeg"),
            "side_photo": ("s.png", _image("PNG"), "image/png"),
        },
    )
    assert response.status_code == 200, response.text
    assert len(detector.shapes) == 2


async def test_exif_orientation_is_applied(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    # A landscape-encoded phone photo tagged "rotate 90°" must reach the detector upright.
    exif = Image.Exif()
    exif[0x0112] = 6
    landscape = _image(size=(1000, 600), exif=exif)
    detector = use_detector(RecordingDetector(body.front_scan()))
    await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", landscape, "image/jpeg")}
    )
    assert detector.shapes[0][:2] == (1000, 600)  # rows, columns: portrait


async def test_retake_reason(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    use_detector(RecordingDetector(body.shifted(body.front_scan(), -body.TOP)))
    response = await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", _image(), "image/jpeg")}
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "photo_retake"
    assert error["details"] == [{"reason": "cropped"}]
    assert "cut off" in error["message"]


async def test_requires_auth(client: httpx.AsyncClient) -> None:
    response = await client.post(
        URL, data=_form(), files={"front_photo": ("f.jpg", _image(), "image/jpeg")}
    )
    assert response.status_code == 401


async def test_requires_consent(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    use_detector(RecordingDetector(body.front_scan()))
    response = await client.post(
        URL,
        headers=auth,
        data=_form(consent="false"),
        files={"front_photo": ("f.jpg", _image(), "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "consent_required"


@pytest.mark.parametrize(
    ("form", "files", "status", "code"),
    [
        pytest.param(_form(height="3"), None, 422, "validation_error", id="height-3cm"),
        pytest.param({"consent": "true"}, None, 422, "validation_error", id="no-height"),
        pytest.param(_form(), {}, 422, "validation_error", id="no-photo"),
        pytest.param(
            _form(),
            {"front_photo": ("f.gif", _image("GIF"), "image/gif")},
            415,
            "unsupported_type",
            id="gif",
        ),
        pytest.param(
            _form(),
            {"front_photo": ("f.txt", b"not an image", "text/plain")},
            422,
            "unreadable_photo",
            id="not-an-image",
        ),
        pytest.param(
            _form(),
            {"front_photo": ("f.jpg", _image(size=(100, 200)), "image/jpeg")},
            422,
            "photo_too_small",
            id="too-small",
        ),
    ],
)
async def test_input_validation(
    client: httpx.AsyncClient,
    auth: dict[str, str],
    use_detector: Any,
    form: dict[str, str],
    files: dict[str, Any] | None,
    status: int,
    code: str,
) -> None:
    use_detector(RecordingDetector(body.front_scan()))
    if files is None:
        files = {"front_photo": ("f.jpg", _image(), "image/jpeg")}
    response = await client.post(URL, headers=auth, data=form, files=files or None)
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


async def test_decompression_bomb_rejected(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    buffer = io.BytesIO()
    Image.new("1", (8000, 6000)).save(buffer, format="PNG")  # 48 MP, tiny file
    use_detector(RecordingDetector(body.front_scan()))
    response = await client.post(
        URL,
        headers=auth,
        data=_form(),
        files={"front_photo": ("f.png", buffer.getvalue(), "image/png")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "photo_too_big"


async def test_photo_over_10mb_rejected(
    client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    use_detector(RecordingDetector(body.front_scan()))
    big = b"\xff\xd8" + bytes(10 * 1024 * 1024)
    response = await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", big, "image/jpeg")}
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "too_large"


async def test_oversized_request_rejected_before_parsing(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    huge = bytes(21 * 1024 * 1024)
    response = await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", huge, "image/jpeg")}
    )
    assert response.status_code == 413


async def test_rate_limited(
    app: FastAPI, client: httpx.AsyncClient, auth: dict[str, str], use_detector: Any
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(estimate_rate_limit=2)
    statuses = []
    for _ in range(3):
        use_detector(RecordingDetector(body.front_scan()))
        response = await client.post(
            URL,
            headers=auth,
            data=_form(),
            files={"front_photo": ("f.jpg", _image(), "image/jpeg")},
        )
        statuses.append(response.status_code)
    assert statuses == [200, 200, 429]
    assert int(response.headers["retry-after"]) > 0
    assert response.json()["error"]["code"] == "rate_limited"


async def test_missing_model_is_503(
    app: FastAPI, client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(pose_model_path="/nonexistent.task")
    response = await client.post(
        URL, headers=auth, data=_form(), files={"front_photo": ("f.jpg", _image(), "image/jpeg")}
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "estimation_unavailable"


MODEL = Path(Settings().pose_model_path)


@pytest.mark.skipif(not MODEL.is_file(), reason="pose model not downloaded")
async def test_real_mediapipe_finds_nobody_in_blank_photo(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    """Smoke test of the real MediaPipe pipeline on a synthetic, person-free image."""
    rng = np.random.default_rng(0)
    noise = Image.fromarray(rng.integers(0, 255, (1000, 600, 3), dtype=np.uint8))
    buffer = io.BytesIO()
    noise.save(buffer, format="JPEG")
    response = await client.post(
        URL,
        headers=auth,
        data=_form(),
        files={"front_photo": ("f.jpg", buffer.getvalue(), "image/jpeg")},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"] == [{"reason": "no_person"}]
