import asyncio
import base64
import io

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from body_fit import garment_image
from body_fit.garment_image import GarmentImageError, fetch, prepare
from body_fit.main import app

BLUE = (30, 60, 160)


def product_photo(background: str = "white", size: tuple[int, int] = (600, 800)) -> bytes:
    """A blue tee with a red logo on a plain backdrop, like a shop's product shot."""
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [
            (150, 100),
            (450, 100),
            (560, 250),
            (460, 300),
            (440, 700),
            (160, 700),
            (140, 300),
            (40, 250),
        ],
        BLUE,
    )
    draw.ellipse((260, 250, 340, 330), (200, 30, 30))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def decode(data_url_or_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data_url_or_bytes))


def test_plain_backdrop_is_cut_out_and_cropped() -> None:
    result = prepare(product_photo())
    assert result.cutout is True
    assert result.color == "#1e3ca0"  # the fabric, not the white backdrop or the red logo
    image = decode(result.jpeg)
    # Cropped to the garment (520 x 600 in the 600 x 800 photo, then scaled to fit 768).
    assert abs(image.width / image.height - 521 / 601) < 0.02
    corner = np.asarray(image.convert("RGB"))[2, 2].astype(int)
    assert np.abs(corner - BLUE).max() < 25  # backdrop replaced with the garment colour


def test_busy_backdrop_is_kept_whole() -> None:
    rng = np.random.default_rng(1)
    noise = Image.fromarray(rng.integers(0, 255, (400, 300, 3), dtype=np.uint8))
    buffer = io.BytesIO()
    noise.save(buffer, "PNG")
    result = prepare(buffer.getvalue())
    assert result.cutout is False
    assert decode(result.jpeg).size == (300, 400)


def test_unreadable_and_unsupported_pictures() -> None:
    with pytest.raises(GarmentImageError) as exc:
        prepare(b"not a picture")
    assert exc.value.code == "unreadable"
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, "BMP")
    with pytest.raises(GarmentImageError) as exc:
        prepare(buffer.getvalue())
    assert exc.value.code == "unsupported_type"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/a.jpg",
        "http://10.0.0.5/a.jpg",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/a.jpg",
        "http://localhost/a.jpg",
        "file:///etc/passwd",
        "ftp://8.8.8.8/a.jpg",
    ],
)
def test_private_and_non_http_addresses_are_refused(url: str) -> None:
    with pytest.raises(GarmentImageError) as exc:
        asyncio.run(fetch(url))
    assert exc.value.code == "bad_url"


def _client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler, follow_redirects=False)


def test_fetch_follows_checked_redirects() -> None:
    photo = product_photo()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old.jpg":
            return httpx.Response(302, headers={"location": "/new.jpg"})
        return httpx.Response(200, headers={"content-type": "image/png"}, content=photo)

    data = asyncio.run(fetch("http://8.8.8.8/old.jpg", _client(httpx.MockTransport(handler))))
    assert data == photo


def test_redirect_to_a_private_address_is_refused() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://192.168.1.1/admin"})

    with pytest.raises(GarmentImageError) as exc:
        asyncio.run(fetch("http://8.8.8.8/a.jpg", _client(httpx.MockTransport(handler))))
    assert exc.value.code == "bad_url"


def test_non_images_and_large_files_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    html = httpx.MockTransport(
        lambda _: httpx.Response(200, headers={"content-type": "text/html"}, text="<p>")
    )
    with pytest.raises(GarmentImageError) as exc:
        asyncio.run(fetch("http://8.8.8.8/a", _client(html)))
    assert exc.value.code == "unsupported_type"

    monkeypatch.setattr(garment_image, "MAX_BYTES", 1000)
    big = httpx.MockTransport(
        lambda _: httpx.Response(200, headers={"content-type": "image/png"}, content=b"x" * 5000)
    )
    with pytest.raises(GarmentImageError) as exc:
        asyncio.run(fetch("http://8.8.8.8/a.png", _client(big)))
    assert exc.value.code == "too_large"


def test_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(url: str) -> bytes:
        assert url == "https://shop.example/tee.png"
        return product_photo()

    monkeypatch.setattr(garment_image, "fetch", fake_fetch)
    client = TestClient(app)
    response = client.post("/garment-image", json={"url": "https://shop.example/tee.png"})
    assert response.status_code == 200
    data = response.json()
    assert data["color"] == "#1e3ca0" and data["cutout"] is True
    header, encoded = data["texture"].split(",", 1)
    assert header == "data:image/jpeg;base64"
    assert decode(base64.b64decode(encoded)).format == "JPEG"

    refused = client.post("/garment-image", json={"url": "file:///etc/passwd"})
    assert refused.status_code == 422


# --- a model wearing the garment ------------------------------------------------------------


def person(visible: set[int] | None = None) -> np.ndarray:
    """Pose landmarks for someone standing in a 600 x 800 photo (x, y, visibility)."""
    points = np.zeros((33, 3))
    places = {
        0: (300, 80),
        11: (380, 200),
        12: (220, 200),
        13: (420, 320),
        14: (180, 320),
        15: (430, 430),
        16: (170, 430),
        23: (350, 450),
        24: (250, 450),
        25: (350, 600),
        26: (250, 600),
        27: (350, 760),
        28: (250, 760),
    }
    for i, (x, y) in places.items():
        points[i] = (x, y, 1.0 if visible is None or i in visible else 0.0)
    return points


class FakePose:
    def __init__(self, landmarks: np.ndarray | None) -> None:
        self.landmarks = landmarks

    def find(self, image: np.ndarray) -> np.ndarray | None:
        return self.landmarks


def test_garment_box_for_a_top_and_a_bottom() -> None:
    top = garment_image.garment_box(person(), "top", (600, 800))
    assert top is not None
    left, upper, right, lower = top
    assert upper < 200 < 450 < lower < 520  # shoulders to just below the hips, not the face
    assert upper > 80 and left < 180 and right > 420  # elbows included
    bottom = garment_image.garment_box(person(), "bottom", (600, 800))
    assert bottom is not None
    assert 380 < bottom[1] < 450 and bottom[3] == 790  # hips to just below the ankles


def test_garment_box_needs_the_body_parts() -> None:
    assert garment_image.garment_box(person(visible={0, 23, 24}), "top", (600, 800)) is None
    hips_only = garment_image.garment_box(person(visible={23, 24}), "bottom", (600, 800))
    assert hips_only is not None and hips_only[3] == 800  # hips down to the edge of the photo
    assert garment_image.garment_box(person(visible={11, 12}), "bottom", (600, 800)) is None


def test_model_photo_is_cropped_to_the_garment() -> None:
    full = prepare(product_photo(), "top", FakePose(None))
    worn = prepare(product_photo(), "top", FakePose(person()))
    assert worn.color == "#1e3ca0"
    assert decode(worn.jpeg).size != decode(full.jpeg).size
