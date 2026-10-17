"""Typed application settings, loaded from environment variables (and `.env` locally)."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, PostgresDsn, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["local", "test", "staging", "production"] = "local"
    log_level: str = "INFO"

    database_url: PostgresDsn = PostgresDsn(
        "postgresql+asyncpg://aurora:aurora@localhost:5432/aurora"
    )

    # Supabase Auth. Tokens are verified against the project's JWKS (asymmetric keys);
    # `supabase_jwt_secret` is only needed for projects still on the legacy HS256 secret.
    supabase_url: AnyHttpUrl | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_secret: SecretStr | None = None

    # Comma-separated in the environment: the web app origin and the extension origin.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    # Optional regex for origins that cannot be listed up front. Local dev sets it to match
    # unpacked browser extensions (their ID depends on the folder); production lists the
    # published extension origin exactly in CORS_ORIGINS instead.
    cors_origin_regex: str | None = None

    # Server-only Supabase secret key; enables keeping photos users opt in to keeping.
    supabase_secret_key: SecretStr | None = None
    photo_bucket: str = "profile-photos"
    photo_url_seconds: int = 600  # lifetime of signed photo URLs

    # Photo estimation.
    pose_model_path: str = "models/pose_landmarker_heavy.task"
    max_photo_bytes: int = 10 * 1024 * 1024
    estimate_rate_limit: int = 10  # requests per user ...
    estimate_rate_window_seconds: int = 600  # ... per this many seconds

    @property
    def max_photo_request_bytes(self) -> int:
        # Two photos plus form fields and multipart overhead.
        return 2 * self.max_photo_bytes + 64 * 1024

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def supabase_auth_url(self) -> str | None:
        if self.supabase_url is None:
            return None
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str | None:
        base = self.supabase_auth_url
        return f"{base}/.well-known/jwks.json" if base else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
