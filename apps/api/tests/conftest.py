"""Shared fixtures. Tokens are signed with keys generated per test run; no real secrets."""

import os
import time
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

os.environ.setdefault("ENVIRONMENT", "test")

import httpx
import jwt
import pytest
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from alembic import command
from app.api.deps import get_photo_store
from app.core.security import CurrentUserDep, TokenVerifier, get_token_verifier
from app.db.session import get_session
from app.main import create_app
from app.services import photos as photos_service

TEST_ISSUER = "https://test-project.supabase.co/auth/v1"
TEST_AUDIENCE = "authenticated"
TEST_HS256_SECRET = "test-only-hs256-secret-with-enough-length-0123456789"
TEST_KID = "test-key"


class StaticKeySource:
    """Stands in for PyJWKClient: resolves the kid in the token header to a local key."""

    def __init__(self, keys: dict[str, jwt.PyJWK]) -> None:
        self._keys = keys

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        kid = jwt.get_unverified_header(token).get("kid")
        if kid not in self._keys:
            raise jwt.PyJWKClientError("Unable to find a signing key that matches")
        return self._keys[kid]


@pytest.fixture(scope="session", autouse=True)
def _release_estimation_resources() -> Iterator[None]:
    yield
    photos_service.shutdown()


@pytest.fixture(scope="session")
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(scope="session")
def verifier(signing_key: ec.EllipticCurvePrivateKey) -> TokenVerifier:
    jwk = jwt.algorithms.ECAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    jwk.update({"kid": TEST_KID, "alg": "ES256"})
    return TokenVerifier(
        audience=TEST_AUDIENCE,
        issuer=TEST_ISSUER,
        key_source=StaticKeySource({TEST_KID: jwt.PyJWK.from_dict(jwk)}),
        hs256_secret=TEST_HS256_SECRET,
    )


TokenFactory = Callable[..., str]


@pytest.fixture(scope="session")
def make_token(signing_key: ec.EllipticCurvePrivateKey) -> TokenFactory:
    def _make(
        *,
        sub: str | None = None,
        expires_in: int = 300,
        key: Any = None,
        algorithm: str = "ES256",
        kid: str = TEST_KID,
        **overrides: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": sub if sub is not None else str(uuid.uuid4()),
            "aud": TEST_AUDIENCE,
            "iss": TEST_ISSUER,
            "role": "authenticated",
            "iat": now,
            "exp": now + expires_in,
        }
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        headers = {"kid": kid} if algorithm != "HS256" else None
        return jwt.encode(claims, key or signing_key, algorithm=algorithm, headers=headers)

    return _make


def _build_app(verifier: TokenVerifier) -> FastAPI:
    app = create_app()
    # A test-only protected route, so the auth dependency is exercised end to end.
    probe = APIRouter()

    @probe.get("/v1/_test/me")
    async def me(user: CurrentUserDep) -> dict[str, str]:
        return {"id": user.id}

    app.include_router(probe)
    app.dependency_overrides[get_token_verifier] = lambda: verifier
    return app


@pytest.fixture
def app(verifier: TokenVerifier) -> FastAPI:
    return _build_app(verifier)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# --- Real Postgres via testcontainers ---------------------------------------------------


def _docker_available() -> bool:
    try:
        import docker  # type: ignore[import-untyped]

        docker.from_env().ping()
    except Exception:
        return False
    return True


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    if not _docker_available():
        pytest.skip("Docker is not running; skipping tests that need Postgres.")
    from testcontainers.community.postgres import PostgresContainer

    with PostgresContainer("postgres:17", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        cfg = Config("alembic.ini")
        cfg.attributes["database_url"] = url
        command.upgrade(cfg, "head")
        yield url


class FakePhotoStore:
    """In-memory stand-in for Supabase Storage."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        assert content_type == "image/jpeg"
        self.objects[key] = data

    async def signed_url(self, key: str, expires_in: int) -> str:
        assert key in self.objects
        return f"https://storage.test/sign/{key}?expires={expires_in}"

    async def delete(self, keys: list[str]) -> None:
        for key in keys:
            self.objects.pop(key, None)


@pytest.fixture
def photo_store() -> FakePhotoStore:
    return FakePhotoStore()


@pytest.fixture
async def db_app(
    database_url: str, verifier: TokenVerifier, photo_store: FakePhotoStore
) -> AsyncIterator[FastAPI]:
    engine = create_async_engine(database_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def _session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    app = _build_app(verifier)
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_photo_store] = lambda: photo_store
    try:
        yield app
    finally:
        async with engine.begin() as conn:
            await conn.execute(
                text("TRUNCATE account_settings, profile_photos, measurement_profiles, saved_items")
            )
        await engine.dispose()


@pytest.fixture
async def db_client(db_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=db_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
