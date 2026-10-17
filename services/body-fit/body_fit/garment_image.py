"""Garment images: fetch a shop's product photo and turn it into a texture for the 3D garment.

Browsers can't read the pixels of most shops' images (no CORS headers), so the website asks
this service instead. Images are processed in memory and nothing is kept or logged.

How: if the photo has a plain backdrop (most product shots), everything connected to the
border in that colour is background, and it is replaced with the garment's own main colour
(so the texture has no holes). If a person is wearing the garment (MediaPipe pose), the picture
is cropped to the top (shoulders to hips) or the bottom (hips to ankles) so their face and
other clothes don't end up on the 3D garment; otherwise it is cropped to the garment itself.
The main colour is returned for the parts of the 3D garment the photo doesn't cover.

Fetching URLs on a server is a classic way to reach internal machines, so only public http(s)
addresses are fetched: every hop of a redirect is resolved and refused if any address is
private, loopback, link-local or otherwise not globally routable.
"""

import asyncio
import base64
import io
import ipaddress
import socket
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from urllib.parse import urljoin, urlsplit

import httpx
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError
from scipy.ndimage import label

Category = Literal["top", "bottom"]
Box = tuple[int, int, int, int]  # left, top, right, bottom (pixels)

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000  # refuse to decode anything larger (decompression bombs)
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(10.0)
WORK_SIDE = 768  # images are processed at this size
OUT_SIDE = 1024
FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
UNREACHABLE = "We couldn't reach the shop's picture."

# Background detection: how close (RGB distance) a pixel must be to the border colour, and
# how much of the border must be that colour for the backdrop to count as plain.
BACKGROUND_TOLERANCE = 30.0
PLAIN_BORDER_SHARE = 0.8
MIN_GARMENT_SHARE = 0.03  # less than this left after removing the backdrop: don't trust it

POSE_MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "pose_landmarker_heavy.task"
MIN_VISIBILITY = 0.5
# MediaPipe pose landmark indices (left/right pairs).
SHOULDERS, ELBOWS, WRISTS = (11, 12), (13, 14), (15, 16)
HIPS, KNEES, ANKLES = (23, 24), (25, 26), (27, 28)


class GarmentImageError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class GarmentImage:
    jpeg: bytes
    color: str  # #rrggbb
    cutout: bool  # the backdrop was found and replaced

    def data_url(self) -> str:
        return "data:image/jpeg;base64," + base64.b64encode(self.jpeg).decode("ascii")


# --- finding the garment on a person -------------------------------------------------------


class PoseFinder(Protocol):
    def find(self, image: NDArray[np.uint8]) -> NDArray[np.float64] | None:
        """(33, 3) landmarks: x, y in pixels and visibility 0..1; None if nobody is there."""
        ...


class MediaPipePoseFinder:
    """Thread-safe: each worker thread lazily gets its own landmarker."""

    def __init__(self, model_path: Path = POSE_MODEL_PATH) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Pose model not found at {model_path}. "
                "Run `uv run python -m scripts.download_models` in services/body-fit."
            )
        self._model_path = model_path
        self._local = threading.local()

    def _landmarker(self) -> PoseLandmarker:
        landmarker: PoseLandmarker | None = getattr(self._local, "landmarker", None)
        if landmarker is None:
            options = PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(self._model_path)),
                running_mode=RunningMode.IMAGE,
                num_poses=1,
            )
            landmarker = PoseLandmarker.create_from_options(options)
            self._local.landmarker = landmarker
        return landmarker

    def find(self, image: NDArray[np.uint8]) -> NDArray[np.float64] | None:
        height, width = image.shape[:2]
        result = self._landmarker().detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image))
        )
        if not result.pose_landmarks:
            return None
        return np.array(
            [
                [lm.x * width, lm.y * height, lm.visibility or 0.0]
                for lm in result.pose_landmarks[0]
            ],
            dtype=np.float64,
        )


def garment_box(
    landmarks: NDArray[np.float64], category: Category, size: tuple[int, int]
) -> Box | None:
    """Where the top (shoulders to just below the hips) or the bottom (hips to ankles) is on a
    person, or None if the needed body parts aren't visible."""
    width, height = size

    def seen(pair: tuple[int, int]) -> NDArray[np.float64]:
        points = landmarks[list(pair)]
        return points[points[:, 2] >= MIN_VISIBILITY, :2]

    shoulders, hips = seen(SHOULDERS), seen(HIPS)
    if len(hips) == 0:
        return None
    hip_y = float(hips[:, 1].mean())
    if category == "top":
        if len(shoulders) == 0:
            return None
        torso = hip_y - float(shoulders[:, 1].mean())
        if torso <= 0:
            return None
        top, bottom = float(shoulders[:, 1].mean()) - 0.15 * torso, hip_y + 0.08 * torso
        xs = np.concatenate([shoulders, hips, seen(ELBOWS)])[:, 0]
        pad = 0.12 * torso
    else:
        # From the hips down; to the ankles if they're in the picture, else to its edge.
        if len(hips) < 2 or float(np.ptp(hips[:, 0])) <= 0:
            return None
        hip_width = float(np.ptp(hips[:, 0]))
        ankles = seen(ANKLES)
        top = hip_y - 0.6 * hip_width
        bottom = float(ankles[:, 1].max()) + 0.3 * hip_width if len(ankles) else float(height)
        xs = np.concatenate([hips, seen(KNEES), ankles])[:, 0]
        pad = 0.6 * hip_width
    box = (
        max(0, round(float(xs.min()) - pad)),
        max(0, round(top)),
        min(width, round(float(xs.max()) + pad)),
        min(height, round(bottom)),
    )
    if box[2] - box[0] < 16 or box[3] - box[1] < 16:
        return None
    return box


# --- image processing ---------------------------------------------------------------------


def _hex(rgb: NDArray[np.floating]) -> str:
    r, g, b = (round(float(v)) for v in np.clip(rgb, 0, 255))
    return f"#{r:02x}{g:02x}{b:02x}"


def _main_color(pixels: NDArray[np.uint8]) -> NDArray[np.float64]:
    """Most common colour (coarse bins), averaged within its bin. Prints and logos lose out to
    the fabric because there is more fabric."""
    bins = (pixels // 32).astype(np.int64)
    keys = bins[:, 0] * 64 + bins[:, 1] * 8 + bins[:, 2]
    top = np.bincount(keys).argmax()
    return np.asarray(pixels[keys == top].mean(axis=0), dtype=np.float64)


def _background(rgb: NDArray[np.uint8]) -> NDArray[np.bool_] | None:
    """Mask of the plain backdrop around the garment, or None if there isn't one."""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float64)
    backdrop = np.median(border, axis=0)
    plain = np.linalg.norm(border - backdrop, axis=1) < BACKGROUND_TOLERANCE
    if plain.mean() < PLAIN_BORDER_SHARE:
        return None
    close = np.linalg.norm(rgb.astype(np.float64) - backdrop, axis=2) < BACKGROUND_TOLERANCE
    regions, _ = label(close)
    edge = np.unique(np.concatenate([regions[0], regions[-1], regions[:, 0], regions[:, -1]]))
    mask = np.isin(regions, edge[edge > 0])
    if (~mask).mean() < MIN_GARMENT_SHARE:
        return None
    return mask


def prepare(
    data: bytes, category: Category = "top", pose: PoseFinder | None = None
) -> GarmentImage:
    """Product photo bytes -> texture (the garment cropped out, backdrop in its colour)."""
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as opened:
            if opened.format not in FORMATS:
                raise GarmentImageError("unsupported_type", "Use a JPEG, PNG, WebP or GIF picture.")
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise GarmentImageError("unreadable", "We couldn't read this product picture.") from exc

    image.thumbnail((WORK_SIDE, WORK_SIDE))
    rgb = np.asarray(image)
    height, width = rgb.shape[:2]
    mask = _background(rgb)

    landmarks = pose.find(rgb) if pose is not None else None
    box = garment_box(landmarks, category, (width, height)) if landmarks is not None else None
    if box is not None:
        # Worn by a model: take the colour from the middle of the garment, away from skin.
        left, top, right, bottom = box
        dx, dy = (right - left) // 4, (bottom - top) // 6
        sample = rgb[top + dy : bottom - dy, left + dx : right - dx]
        keep = ~mask[top + dy : bottom - dy, left + dx : right - dx] if mask is not None else None
        pixels = sample[keep] if keep is not None and keep.any() else sample.reshape(-1, 3)
    elif mask is not None:
        ys, xs = np.nonzero(~mask)
        box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        pixels = rgb[~mask]
    else:
        # No backdrop and nobody wearing it: use it whole, colour from the middle.
        box = (0, 0, width, height)
        pixels = rgb[height // 4 : 3 * height // 4, width // 4 : 3 * width // 4].reshape(-1, 3)
    color = _main_color(pixels)

    filled = rgb if mask is None else np.where(mask[..., None], color.astype(np.uint8), rgb)
    left, top, right, bottom = box
    out = Image.fromarray(np.ascontiguousarray(filled[top:bottom, left:right]))
    out.thumbnail((OUT_SIDE, OUT_SIDE))
    buffer = io.BytesIO()
    out.save(buffer, "JPEG", quality=85)
    return GarmentImage(jpeg=buffer.getvalue(), color=_hex(color), cutout=mask is not None)


# --- fetching -------------------------------------------------------------------------------


async def _check_public(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise GarmentImageError("bad_url", "Only http and https picture links can be used.")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise GarmentImageError("unreachable", UNREACHABLE) from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            raise GarmentImageError("bad_url", "This picture link isn't a public web address.")


async def fetch(url: str, client: httpx.AsyncClient | None = None) -> bytes:
    """Download a public image, following up to MAX_REDIRECTS redirects, each one checked.

    Known limit: the address is checked, then httpx resolves the name again to connect, so a
    DNS server that answers differently the second time could still point it elsewhere.
    """
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)
    try:
        for _ in range(MAX_REDIRECTS + 1):
            await _check_public(url)
            try:
                async with client.stream("GET", url, headers={"Accept": "image/*"}) as response:
                    if response.is_redirect and "location" in response.headers:
                        url = urljoin(url, response.headers["location"])
                        continue
                    if response.status_code != 200:
                        raise GarmentImageError("unreachable", "The shop didn't send the picture.")
                    kind = response.headers.get("content-type", "")
                    if not kind.startswith("image/"):
                        raise GarmentImageError("unsupported_type", "This link isn't a picture.")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_BYTES:
                            raise GarmentImageError("too_large", "This picture is too large.")
                    return bytes(data)
            except httpx.HTTPError as exc:
                raise GarmentImageError("unreachable", UNREACHABLE) from exc
        raise GarmentImageError("unreachable", "The picture link redirects too many times.")
    finally:
        if owned:
            await client.aclose()
