"""Photo likeness: bake the face from a front photo into the body's texture, and pick skin and
eye colours from it.

The photo is personal data. It is processed in memory and never written or logged here; the
caller gets the texture back and nothing is kept.

How: MediaPipe finds the face; an affine map takes the body's eye and mouth joints (seen from
the front) onto the eyes and mouth in the photo. Every texel of the head is then traced back to
its 3D point on the body, projected into the photo, and sampled. A soft face-oval mask and the
surface's angle to the camera blend the photo into the plain skin colour.
"""

import io
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError
from scipy.ndimage import map_coordinates, maximum_filter

from body_fit.body import Body
from body_fit.measure import F, I

RGB = NDArray[np.uint8]

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"
MAX_PIXELS = 40_000_000  # refuse to decode anything larger (decompression bombs)
MAX_SIDE = 2048  # photos are downscaled to this before detection
MIN_SIDE = 320  # smaller photos are too low resolution
MIN_EYE_DISTANCE_PX = 40  # below this the face is too small to be useful
MAX_YAW = 0.2  # nose offset from the eye midpoint, as a fraction of the eye distance
TEXTURE_SIZE = 2048

# MediaPipe face mesh landmark indices. "Left"/"right" are the person's own sides.
RIGHT_EYE = (33, 133)
LEFT_EYE = (362, 263)
MOUTH = (61, 291, 13, 14)
NOSE_TIP = 1
CHEEKS_AND_FOREHEAD = (50, 280, 151)
RIGHT_IRIS, LEFT_IRIS = 468, 473
FACE_OVAL = (
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
)  # fmt: skip


class LikenessError(Exception):
    """A photo we can't use, with a message to show the user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FaceDetector(Protocol):
    def detect(self, image: RGB) -> list[F]:
        """Landmarks (n, 2) in pixels for every face found."""
        ...


class MediaPipeFaceDetector:
    """Thread-safe: each worker thread lazily gets its own landmarker."""

    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Face model not found at {model_path}. "
                "Run `uv run python -m scripts.download_models` in services/body-fit."
            )
        self._model_path = model_path
        self._local = threading.local()

    def _landmarker(self) -> FaceLandmarker:
        landmarker: FaceLandmarker | None = getattr(self._local, "landmarker", None)
        if landmarker is None:
            options = FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(self._model_path)),
                running_mode=RunningMode.IMAGE,
                num_faces=2,  # find a second face so we can ask for a photo of one person
            )
            landmarker = FaceLandmarker.create_from_options(options)
            self._local.landmarker = landmarker
        return landmarker

    def detect(self, image: RGB) -> list[F]:
        height, width = image.shape[:2]
        result = self._landmarker().detect(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image))
        )
        return [
            np.array([[lm.x * width, lm.y * height] for lm in face], dtype=np.float64)
            for face in result.face_landmarks
        ]


@dataclass(frozen=True)
class Likeness:
    texture_png: bytes
    skin_color: str  # "#rrggbb"
    eye_color: str | None


def decode_photo(data: bytes) -> RGB:
    """Upright RGB pixels, at most MAX_SIDE on the long side."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.width * img.height > MAX_PIXELS:
                raise LikenessError(
                    "photo_too_large", "This photo is too large. Please use a smaller one."
                )
            upright = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise LikenessError("invalid_image", "We couldn't read this file as a photo.") from exc
    upright.thumbnail((MAX_SIDE, MAX_SIDE))
    if min(upright.size) < MIN_SIDE:
        raise LikenessError(
            "low_resolution",
            f"This photo is too small. Please use one at least {MIN_SIDE} pixels on each side.",
        )
    return np.asarray(upright, dtype=np.uint8)


@dataclass(frozen=True)
class FacePoints:
    landmarks: F
    left_eye: F
    right_eye: F
    mouth: F
    eye_distance: float


def find_face(image: RGB, detector: FaceDetector) -> FacePoints:
    faces = detector.detect(image)
    if not faces:
        raise LikenessError(
            "no_face",
            "We couldn't find a face. Use a front photo with your face clearly visible and lit.",
        )
    if len(faces) > 1:
        raise LikenessError(
            "multiple_faces", "We found more than one face. Please use a photo of just you."
        )
    lm = faces[0]
    right_eye, left_eye = lm[list(RIGHT_EYE)].mean(axis=0), lm[list(LEFT_EYE)].mean(axis=0)
    eye_distance = float(np.linalg.norm(left_eye - right_eye))
    if eye_distance < MIN_EYE_DISTANCE_PX:
        raise LikenessError(
            "face_too_small",
            "Your face is too small in this photo. Use a closer photo or a higher-resolution one.",
        )
    nose_offset = float(np.dot(lm[NOSE_TIP] - (left_eye + right_eye) / 2, left_eye - right_eye))
    if abs(nose_offset) / eye_distance**2 > MAX_YAW:
        raise LikenessError(
            "face_turned", "Your face is turned to the side. Please look straight at the camera."
        )
    return FacePoints(lm, left_eye, right_eye, lm[list(MOUTH)].mean(axis=0), eye_distance)


@dataclass(frozen=True)
class HeadTexels:
    """Head texels of the body texture and where each sits on the body (front view)."""

    rows: I
    cols: I
    xyz: F  # (k, 3) metres
    facing: F  # (k,) how directly the surface faces the camera (normal z), -1..1


def vertex_normals(pos: F, tris: I) -> F:
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(pos)
    for k in range(3):
        np.add.at(normals, tris[:, k], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


def head_texels(body: Body, pos: F, size: int = TEXTURE_SIZE) -> HeadTexels:
    """Rasterise the head triangles (from just below the chin up) into texture space."""
    joints = body.joint_positions(pos)
    eyes_y = float(joints["l-eye"][1] + joints["r-eye"][1]) / 2
    lips_y = float(joints["lips"][1])
    below_chin = lips_y - 1.3 * (eyes_y - lips_y)
    normals = vertex_normals(pos, body.tris)
    head = np.flatnonzero(pos[body.tris, 1].min(axis=1) > below_chin)
    rows: list[I] = []
    cols: list[I] = []
    xyz: list[F] = []
    facing: list[F] = []
    for t in head:
        corners = body.tris[t]
        uv = body.uvs[body.tri_uvs[t]] * size - 0.5  # texel centres sit at integer coordinates
        lo = np.floor(uv.min(axis=0)).astype(np.int64)
        hi = np.ceil(uv.max(axis=0)).astype(np.int64)
        gc, gr = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1))
        p = np.stack([gc.ravel(), gr.ravel()], axis=1).astype(np.float64)
        m = np.array([uv[1] - uv[0], uv[2] - uv[0]]).T
        if abs(np.linalg.det(m)) < 1e-9:
            continue
        b12 = np.linalg.solve(m, (p - uv[0]).T).T
        bary = np.column_stack([1 - b12.sum(axis=1), b12])
        inside = (bary >= -1e-3).all(axis=1)
        bary, p = bary[inside], p[inside]
        rows.append(p[:, 1].astype(np.int64))
        cols.append(p[:, 0].astype(np.int64))
        xyz.append(bary @ pos[corners])
        facing.append(bary @ normals[corners][:, 2])
    r, c = np.concatenate(rows), np.concatenate(cols)
    valid = (r >= 0) & (r < size) & (c >= 0) & (c < size)
    return HeadTexels(r[valid], c[valid], np.concatenate(xyz)[valid], np.concatenate(facing)[valid])


DEPTH_CELL_M = 0.002
DEPTH_SLACK_M = 0.006


def seen_from_front(body: Body, pos: F, points: F) -> NDArray[np.bool_]:
    """Whether each point is on the outermost surface seen from the front, not inside the mouth,
    nostrils or eye sockets (which also face the camera but sit behind the face)."""
    tris = body.tris[pos[body.tris, 1].min(axis=1) > points[:, 1].min() - 0.01]
    corners = pos[tris]  # (t, 3, 3)
    midpoints = (corners + np.roll(corners, 1, axis=1)) / 2
    samples = np.concatenate(
        [corners.reshape(-1, 3), corners.mean(axis=1), midpoints.reshape(-1, 3)]
    )
    lo = samples[:, :2].min(axis=0)
    cells = np.floor((samples[:, :2] - lo) / DEPTH_CELL_M).astype(np.int64)
    shape = cells.max(axis=0) + 1
    depth = np.full((int(shape[0]), int(shape[1])), -np.inf)
    np.maximum.at(depth, (cells[:, 0], cells[:, 1]), samples[:, 2])
    depth = maximum_filter(depth, size=3)
    at = np.floor((points[:, :2] - lo) / DEPTH_CELL_M).astype(np.int64)
    at = np.clip(at, 0, shape - 1)
    return np.asarray(points[:, 2] >= depth[at[:, 0], at[:, 1]] - DEPTH_SLACK_M)


def body_to_photo(body: Body, pos: F, face: FacePoints) -> F:
    """Affine map (3, 2): [x, y, 1] in metres -> photo pixels, from eyes and mouth."""
    joints = body.joint_positions(pos)
    src = np.array([[*joints[name][:2], 1.0] for name in ("l-eye", "r-eye", "lips")])
    dst = np.array([face.left_eye, face.right_eye, face.mouth])
    return np.linalg.solve(src, dst)


def face_mask(face: FacePoints, xy: F) -> F:
    """Soft mask (0..1) over the face oval at photo points xy, pulled in from hairline and jaw."""
    oval = face.landmarks[list(FACE_OVAL)]
    centre = oval.mean(axis=0)
    shrunk = centre + (oval - centre) * 0.92
    blur = face.eye_distance * 0.18
    origin = np.floor(shrunk.min(axis=0) - 3 * blur)
    extent = np.ceil(shrunk.max(axis=0) + 3 * blur - origin).astype(np.int64)
    mask = Image.new("L", (int(extent[0]), int(extent[1])), 0)
    ImageDraw.Draw(mask).polygon([(float(x), float(y)) for x, y in shrunk - origin], fill=255)
    pixels = np.asarray(mask.filter(ImageFilter.GaussianBlur(radius=blur)), dtype=np.float64)
    local = xy - origin
    return np.asarray(map_coordinates(pixels / 255, [local[:, 1], local[:, 0]], order=1))


def _median_color(image: RGB, points: F, radius: float) -> NDArray[np.float64]:
    height, width = image.shape[:2]
    pixels = []
    for x, y in points:
        top, left = max(0, int(y - radius)), max(0, int(x - radius))
        patch = image[
            top : min(height, int(y + radius) + 1), left : min(width, int(x + radius) + 1)
        ]
        ys, xs = np.mgrid[top : top + patch.shape[0], left : left + patch.shape[1]]
        pixels.append(patch[(xs - x) ** 2 + (ys - y) ** 2 <= radius**2])
    return np.median(np.concatenate(pixels).astype(np.float64), axis=0)


def _hex(rgb: NDArray[np.float64]) -> str:
    r, g, b = (round(float(v)) for v in np.clip(rgb, 0, 255))
    return f"#{r:02x}{g:02x}{b:02x}"


def _smoothstep(x: F, lo: float, hi: float) -> F:
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def bake_likeness(
    data: bytes,
    body: Body,
    weights: dict[str, float],
    detector: FaceDetector,
    size: int = TEXTURE_SIZE,
) -> Likeness:
    image = decode_photo(data)
    face = find_face(image, detector)
    skin = _median_color(
        image, face.landmarks[list(CHEEKS_AND_FOREHEAD)], radius=face.eye_distance * 0.12
    )
    eye = None
    if len(face.landmarks) > LEFT_IRIS:
        irises = face.landmarks[[RIGHT_IRIS, LEFT_IRIS]]
        eye = _hex(_median_color(image, irises, radius=face.eye_distance * 0.04))

    pos = body.positions(weights)
    texels = head_texels(body, pos, size)
    affine = body_to_photo(body, pos, face)
    alpha = _smoothstep(texels.facing, 0.25, 0.6)
    alpha *= seen_from_front(body, pos, texels.xyz)
    keep = alpha > 0
    rows, cols, xyz, alpha = texels.rows[keep], texels.cols[keep], texels.xyz[keep], alpha[keep]
    photo_xy = np.column_stack([xyz[:, :2], np.ones(len(xyz))]) @ affine  # (k, 2) x, y px
    alpha *= face_mask(face, photo_xy)
    coords = [photo_xy[:, 1], photo_xy[:, 0]]  # map_coordinates wants rows, cols
    sampled = np.stack(
        [map_coordinates(image[..., ch], coords, order=1, output=np.float64) for ch in range(3)],
        axis=1,
    )

    texture = np.empty((size, size, 3), dtype=np.uint8)
    texture[:] = np.round(skin).astype(np.uint8)
    blended = skin * (1 - alpha[:, None]) + sampled * alpha[:, None]
    texture[rows, cols] = np.clip(blended, 0, 255).round().astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(texture).save(out, format="PNG", compress_level=3)
    return Likeness(texture_png=out.getvalue(), skin_color=_hex(skin), eye_color=eye)
