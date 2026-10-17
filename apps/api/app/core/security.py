"""Supabase JWT verification.

FastAPI never issues tokens or stores passwords; it only verifies the access token that
Supabase Auth issued (signature, expiry, audience, issuer) and returns the user id.
"""

import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)

ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
_REQUIRED_CLAIMS = ["exp", "sub", "aud"]


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: str


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK: ...


class InvalidTokenError(Exception):
    pass


class TokenVerifier:
    def __init__(
        self,
        *,
        audience: str,
        issuer: str | None,
        key_source: SigningKeySource | None,
        hs256_secret: str | None,
    ) -> None:
        self._audience = audience
        self._issuer = issuer
        self._key_source = key_source
        self._hs256_secret = hs256_secret

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            alg = jwt.get_unverified_header(token).get("alg")
            if alg in ASYMMETRIC_ALGORITHMS and self._key_source is not None:
                # PyJWKClient does blocking HTTP on a cache miss; keep it off the event loop.
                signing_key = await asyncio.to_thread(
                    self._key_source.get_signing_key_from_jwt, token
                )
                return self._decode(token, signing_key.key, [alg])
            if alg == "HS256" and self._hs256_secret is not None:
                return self._decode(token, self._hs256_secret, ["HS256"])
        except jwt.PyJWKClientConnectionError:
            raise  # an outage on our side, not a bad token
        except jwt.PyJWTError as exc:
            raise InvalidTokenError(type(exc).__name__) from exc
        raise InvalidTokenError("unsupported_algorithm")

    def _decode(self, token: str, key: Any, algorithms: list[str]) -> dict[str, Any]:
        claims: dict[str, Any] = jwt.decode(
            token,
            key=key,
            algorithms=algorithms,
            audience=self._audience,
            issuer=self._issuer,
            options={"require": _REQUIRED_CLAIMS, "verify_iss": self._issuer is not None},
            leeway=10,
        )
        return claims


def build_token_verifier(settings: Settings) -> TokenVerifier:
    jwks_url = settings.jwks_url
    secret = settings.supabase_jwt_secret
    return TokenVerifier(
        audience=settings.supabase_jwt_audience,
        issuer=settings.supabase_auth_url,
        key_source=jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600, timeout=5)
        if jwks_url
        else None,
        hs256_secret=secret.get_secret_value() if secret else None,
    )


@lru_cache
def _cached_verifier() -> TokenVerifier:
    return build_token_verifier(get_settings())


def get_token_verifier() -> TokenVerifier:
    return _cached_verifier()


_bearer = HTTPBearer(auto_error=False)


def _unauthorized(message: str) -> AppError:
    return AppError(
        status.HTTP_401_UNAUTHORIZED,
        "unauthorized",
        message,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Missing bearer token.")
    try:
        claims = await verifier.verify(credentials.credentials)
    except InvalidTokenError as exc:
        # Log the failure reason only, never the token itself.
        logger.info("Rejected access token: %s", exc)
        raise _unauthorized("Invalid or expired token.") from exc
    except jwt.PyJWKClientConnectionError as exc:
        logger.warning("Could not reach the JWKS endpoint")
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth_unavailable", "Try again shortly."
        ) from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _unauthorized("Invalid or expired token.")
    return CurrentUser(id=subject)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
