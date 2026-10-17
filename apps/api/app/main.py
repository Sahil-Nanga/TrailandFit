from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.formparsers import MultiPartParser

from app.api import v1_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.limits import BodySizeLimitMiddleware
from app.core.logging import configure_logging
from app.db.session import dispose_engine
from app.services import photos as photos_service


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()
    photos_service.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Aurora Fitting Room API",
        version="0.1.0",
        lifespan=lifespan,
        # Interactive docs only outside production; the OpenAPI JSON stays for client generation.
        docs_url=None if settings.environment == "production" else "/docs",
        redoc_url=None,
    )
    # Keep uploads in memory instead of spooling them to temporary files: photos must never
    # touch disk. BodySizeLimitMiddleware caps how large such an upload can be.
    MultiPartParser.spool_max_size = settings.max_photo_request_bytes
    app.add_middleware(
        BodySizeLimitMiddleware,
        path_prefix="/v1/photos",
        max_bytes=settings.max_photo_request_bytes,
    )
    # Added last so it is outermost: error responses from inner middleware get CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=False,  # auth is a bearer header, not cookies
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(v1_router)
    return app


app = create_app()
