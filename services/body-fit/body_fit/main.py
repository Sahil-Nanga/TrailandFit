"""HTTP API.

POST /fit: measurements in, morph weights and the fitted body's measurements out.
POST /likeness: a front photo in, a body texture with the face baked in out.
POST /garment-image: a shop's product picture URL in, a garment texture and colour out.

Measurements and photos are personal data: they are never logged or stored here.
"""

import asyncio
import base64
import os
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from body_fit import garment_image
from body_fit.body import load_body, shape_weights
from body_fit.fit import TOLERANCE_M, fit
from body_fit.garment_image import GarmentImageError
from body_fit.likeness import FaceDetector, LikenessError, MediaPipeFaceDetector, bake_likeness
from body_fit.measure import DIMENSIONS

MAX_PHOTO_BYTES = 10 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}

Cm = Annotated[float, Field(gt=0, le=300)]


class FitMeasurements(BaseModel):
    model_config = ConfigDict(extra="ignore")

    height_cm: Annotated[float, Field(ge=50, le=272)]
    weight_kg: Annotated[float, Field(ge=20, le=400)] | None = None
    chest_cm: Cm | None = None
    waist_cm: Cm | None = None
    hips_cm: Cm | None = None
    shoulder_width_cm: Cm | None = None
    inseam_cm: Cm | None = None


class FitRequest(BaseModel):
    measurements: FitMeasurements
    body_type: Annotated[float, Field(ge=0, le=1, description="0 feminine .. 1 masculine")] = 0.5


class FitResponse(BaseModel):
    weights: dict[str, float]
    scale: float
    measured_cm: dict[str, float] = Field(description="The fitted body, measured, in cm")
    residuals_cm: dict[str, float] = Field(description="Measured minus requested, in cm")
    within_tolerance: bool
    tolerance_cm: float


app = FastAPI(title="Trialandfit body-fit", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "BODY_FIT_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(","),
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


class LikenessResponse(BaseModel):
    texture: str = Field(description="PNG data URL of the body texture (glTF UV layout)")
    skin_color: str = Field(description="#rrggbb")
    eye_color: str | None = Field(description="#rrggbb, when the irises were visible")


class GarmentImageRequest(BaseModel):
    url: AnyHttpUrl = Field(description="The product picture saved with the item")
    category: Literal["top", "bottom"] = Field(
        "top", description="Which garment to crop out when a model is wearing it"
    )


class GarmentImageResponse(BaseModel):
    texture: str = Field(description="JPEG data URL: the garment, cropped, on its own colour")
    color: str = Field(description="#rrggbb, the garment's main colour")
    cutout: bool = Field(description="Whether the photo's backdrop was found and removed")


@app.exception_handler(LikenessError)
@app.exception_handler(GarmentImageError)
async def likeness_error(_: Request, exc: LikenessError | GarmentImageError) -> JSONResponse:
    error = {"code": exc.code, "message": exc.message}
    return JSONResponse(status_code=422, content={"error": error})


@lru_cache
def pose_finder() -> garment_image.PoseFinder | None:
    """None when the pose model isn't downloaded: pictures are then cropped without it."""
    try:
        return garment_image.MediaPipePoseFinder()
    except FileNotFoundError:
        return None


@lru_cache
def face_detector() -> FaceDetector:
    return MediaPipeFaceDetector()


Weights = TypeAdapter(dict[str, Annotated[float, Field(ge=0, le=1)]])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/fit", response_model=FitResponse)
async def fit_body(request: FitRequest) -> FitResponse:
    m = request.measurements
    targets = {
        "height": m.height_cm,
        "chest": m.chest_cm,
        "waist": m.waist_cm,
        "hips": m.hips_cm,
        "shoulderWidth": m.shoulder_width_cm,
        "inseam": m.inseam_cm,
    }
    # CPU-bound (~0.5 s): keep the event loop free.
    result = await asyncio.to_thread(fit, targets, request.body_type, m.weight_kg)
    return FitResponse(
        weights={k: round(v, 5) for k, v in result.weights.items()},
        scale=round(result.scale, 6),
        measured_cm={k: round(result.measured[k] * 100, 2) for k in DIMENSIONS},
        residuals_cm={k: round(v * 100, 2) for k, v in result.residuals.items()},
        within_tolerance=result.within_tolerance,
        tolerance_cm=TOLERANCE_M * 100,
    )


@app.post("/likeness", response_model=LikenessResponse)
async def likeness(
    photo: Annotated[UploadFile, File(description="Front photo, JPEG/PNG/WebP, up to 10 MB")],
    weights: Annotated[str, Form(description="JSON object of morph weights from /fit")] = "{}",
    body_type: Annotated[float, Form(ge=0, le=1)] = 0.5,
) -> LikenessResponse:
    if photo.content_type not in PHOTO_TYPES:
        raise LikenessError("unsupported_type", "Please use a JPEG, PNG or WebP photo.")
    data = await photo.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise LikenessError("photo_too_large", "This photo is over 10 MB. Please use a smaller one")
    try:
        morphs = Weights.validate_json(weights) or shape_weights(body_type, {})
    except ValidationError as exc:
        raise LikenessError("invalid_weights", "Body shape weights are invalid.") from exc
    try:
        detector = face_detector()
    except FileNotFoundError as exc:
        raise LikenessError("unavailable", "Face matching isn't set up on this server.") from exc
    # CPU-bound (~1-2 s): keep the event loop free.
    result = await asyncio.to_thread(bake_likeness, data, load_body(), morphs, detector)
    encoded = base64.b64encode(result.texture_png).decode("ascii")
    return LikenessResponse(
        texture=f"data:image/png;base64,{encoded}",
        skin_color=result.skin_color,
        eye_color=result.eye_color,
    )


@app.post("/garment-image", response_model=GarmentImageResponse)
async def garment_texture(request: GarmentImageRequest) -> GarmentImageResponse:
    data = await garment_image.fetch(str(request.url))
    # CPU-bound (~0.1 s): keep the event loop free.
    result = await asyncio.to_thread(garment_image.prepare, data, request.category, pose_finder())
    return GarmentImageResponse(texture=result.data_url(), color=result.color, cutout=result.cutout)
