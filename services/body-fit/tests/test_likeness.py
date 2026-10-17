"""Likeness baking, with synthetic images and a fake face detector (no real photos)."""

import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from body_fit import main
from body_fit.body import load_body, shape_weights
from body_fit.likeness import (
    CHEEKS_AND_FOREHEAD,
    FACE_OVAL,
    LEFT_EYE,
    MOUTH,
    NOSE_TIP,
    RIGHT_EYE,
    LikenessError,
    bake_likeness,
    body_to_photo,
    find_face,
)
from body_fit.measure import F

SKIN = (200, 150, 120)
MARK = (40, 60, 220)  # a blue patch on the nose, to find in the texture


def landmarks(cx: float = 400, cy: float = 420, eye_distance: float = 120, yaw_px: float = 0) -> F:
    """478 MediaPipe-style landmarks for a face centred at (cx, cy)."""
    lm = np.tile([cx, cy], (478, 1)).astype(np.float64)
    half = eye_distance / 2
    lm[list(RIGHT_EYE)] = [cx - half, cy - 40]  # the person's right eye is on the image's left
    lm[list(LEFT_EYE)] = [cx + half, cy - 40]
    lm[list(MOUTH)] = [cx, cy + 0.95 * eye_distance - 40]
    lm[NOSE_TIP] = [cx + yaw_px, cy + 5]
    lm[list(CHEEKS_AND_FOREHEAD)] = [[cx - 70, cy + 20], [cx + 70, cy + 20], [cx, cy - 110]]
    angles = np.linspace(0, 2 * np.pi, len(FACE_OVAL), endpoint=False)
    lm[list(FACE_OVAL)] = np.column_stack(
        [cx + 1.25 * eye_distance * np.sin(angles), cy - 1.5 * eye_distance * np.cos(angles)]
    )
    return lm


class FakeDetector:
    def __init__(self, faces: list[F]) -> None:
        self.faces = faces

    def detect(self, image: np.ndarray) -> list[F]:
        return self.faces


def photo(size: tuple[int, int] = (800, 1000), fmt: str = "JPEG") -> bytes:
    img = Image.new("RGB", size, (90, 110, 90))
    draw = ImageDraw.Draw(img)
    draw.ellipse((250, 240, 550, 600), fill=SKIN)
    draw.rectangle((385, 390, 415, 440), fill=MARK)
    out = io.BytesIO()
    img.save(out, format=fmt)
    return out.getvalue()


def bake(data: bytes, faces: list[F], size: int = 512) -> tuple[np.ndarray, str]:
    body = load_body()
    result = bake_likeness(data, body, shape_weights(0.5, {}), FakeDetector(faces), size=size)
    texture = np.asarray(Image.open(io.BytesIO(result.texture_png)).convert("RGB"))
    return texture, result.skin_color


def test_bakes_the_face_into_the_texture() -> None:
    texture, skin = bake(photo(), [landmarks()])
    assert texture.shape == (512, 512, 3)
    r, g, b = (int(skin[i : i + 2], 16) for i in (1, 3, 5))
    assert abs(r - SKIN[0]) < 6 and abs(g - SKIN[1]) < 6 and abs(b - SKIN[2]) < 6
    # The nose mark shows up somewhere on the head, and most of the texture stays plain skin.
    blue = (texture[..., 2] > 160) & (texture[..., 0] < 100)
    assert 0 < blue.sum() < 0.01 * texture.shape[0] * texture.shape[1]


def test_eyes_and_lips_land_on_the_photo() -> None:
    body = load_body()
    pos = body.positions(shape_weights(0.5, {}))
    lm = landmarks()
    face = find_face(np.zeros((1000, 800, 3), dtype=np.uint8), FakeDetector([lm]))
    affine = body_to_photo(body, pos, face)
    joints = body.joint_positions(pos)
    pairs = (("l-eye", face.left_eye), ("r-eye", face.right_eye), ("lips", face.mouth))
    for joint, target in pairs:
        mapped = np.array([*joints[joint][:2], 1.0]) @ affine
        assert np.allclose(mapped, target, atol=1e-6)
    # The person's left eye is on the image's right.
    assert face.left_eye[0] > face.right_eye[0]


@pytest.mark.parametrize(
    ("faces", "code"),
    [
        ([], "no_face"),
        ([landmarks(), landmarks(cx=200)], "multiple_faces"),
        ([landmarks(eye_distance=20)], "face_too_small"),
        ([landmarks(yaw_px=40)], "face_turned"),
    ],
)
def test_rejects_unusable_faces(faces: list[F], code: str) -> None:
    with pytest.raises(LikenessError) as error:
        bake(photo(), faces)
    assert error.value.code == code
    assert error.value.message


def test_rejects_low_resolution() -> None:
    with pytest.raises(LikenessError) as error:
        bake(photo(size=(200, 240)), [landmarks()])
    assert error.value.code == "low_resolution"


def test_rejects_non_images_and_huge_images() -> None:
    with pytest.raises(LikenessError) as error:
        bake(b"definitely not a photo", [landmarks()])
    assert error.value.code == "invalid_image"
    huge = io.BytesIO()
    Image.new("1", (7000, 7000)).save(huge, format="PNG")
    with pytest.raises(LikenessError) as error:
        bake(huge.getvalue(), [landmarks()])
    assert error.value.code == "photo_too_large"


# --- HTTP ---------------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(main, "face_detector", lambda: FakeDetector([landmarks()]))
    return TestClient(main.app)


def test_likeness_endpoint(client: TestClient) -> None:
    response = client.post(
        "/likeness",
        files={"photo": ("me.jpg", photo(), "image/jpeg")},
        data={"body_type": "0.3"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["skin_color"].startswith("#") and len(data["skin_color"]) == 7
    prefix = "data:image/png;base64,"
    assert data["texture"].startswith(prefix)
    texture = Image.open(io.BytesIO(base64.b64decode(data["texture"][len(prefix) :])))
    assert texture.size == (2048, 2048)


def test_likeness_endpoint_errors(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    gif = client.post("/likeness", files={"photo": ("me.gif", b"GIF89a", "image/gif")})
    assert gif.status_code == 422
    assert gif.json()["error"]["code"] == "unsupported_type"

    bad_weights = client.post(
        "/likeness",
        files={"photo": ("me.jpg", photo(), "image/jpeg")},
        data={"weights": '{"female": 3}'},
    )
    assert bad_weights.json()["error"]["code"] == "invalid_weights"

    monkeypatch.setattr(main, "face_detector", lambda: FakeDetector([]))
    no_face = client.post("/likeness", files={"photo": ("me.jpg", photo(), "image/jpeg")})
    assert no_face.status_code == 422
    assert no_face.json()["error"]["code"] == "no_face"

    missing = client.post("/likeness", data={"body_type": "0.5"})
    assert missing.status_code == 422
