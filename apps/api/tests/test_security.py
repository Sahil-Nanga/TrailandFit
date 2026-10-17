from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI

from app.core.security import TokenVerifier, get_token_verifier
from tests.conftest import TEST_HS256_SECRET, TEST_ISSUER, StaticKeySource, TokenFactory

ME = "/v1/_test/me"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _assert_unauthorized(response: httpx.Response) -> None:
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthorized"


async def test_valid_token_returns_user_id(
    client: httpx.AsyncClient, make_token: TokenFactory
) -> None:
    response = await client.get(ME, headers=_bearer(make_token(sub="user-123")))
    assert response.status_code == 200
    assert response.json() == {"id": "user-123"}


async def test_legacy_hs256_token_accepted(
    client: httpx.AsyncClient, make_token: TokenFactory
) -> None:
    token = make_token(sub="user-hs", key=TEST_HS256_SECRET, algorithm="HS256")
    response = await client.get(ME, headers=_bearer(token))
    assert response.status_code == 200
    assert response.json() == {"id": "user-hs"}


async def test_missing_token(client: httpx.AsyncClient) -> None:
    _assert_unauthorized(await client.get(ME))


async def test_non_bearer_scheme(client: httpx.AsyncClient) -> None:
    _assert_unauthorized(await client.get(ME, headers={"Authorization": "Basic abc"}))


async def test_malformed_token(client: httpx.AsyncClient) -> None:
    _assert_unauthorized(await client.get(ME, headers=_bearer("not.a.jwt")))


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"expires_in": -60}, id="expired"),
        pytest.param({"aud": "anon"}, id="wrong-audience"),
        pytest.param({"iss": "https://evil.example/auth/v1"}, id="wrong-issuer"),
        pytest.param({"sub": ""}, id="empty-subject"),
        pytest.param({"exp": None}, id="missing-exp"),
        pytest.param({"kid": "unknown-key"}, id="unknown-kid"),
    ],
)
async def test_rejected_claims(
    client: httpx.AsyncClient, make_token: TokenFactory, overrides: dict[str, Any]
) -> None:
    _assert_unauthorized(await client.get(ME, headers=_bearer(make_token(**overrides))))


async def test_signature_from_other_key(
    client: httpx.AsyncClient, make_token: TokenFactory
) -> None:
    other_key = ec.generate_private_key(ec.SECP256R1())
    _assert_unauthorized(await client.get(ME, headers=_bearer(make_token(key=other_key))))


async def test_hs256_with_wrong_secret(client: httpx.AsyncClient, make_token: TokenFactory) -> None:
    token = make_token(key="a-different-secret-that-is-also-long-enough-000", algorithm="HS256")
    _assert_unauthorized(await client.get(ME, headers=_bearer(token)))


async def test_alg_none_rejected(client: httpx.AsyncClient) -> None:
    token = jwt.encode({"sub": "x", "aud": "authenticated"}, key="", algorithm="none")
    _assert_unauthorized(await client.get(ME, headers=_bearer(token)))


async def test_hs256_rejected_when_no_secret_configured(
    app: FastAPI, client: httpx.AsyncClient, make_token: TokenFactory
) -> None:
    no_secret = TokenVerifier(
        audience="authenticated",
        issuer=TEST_ISSUER,
        key_source=StaticKeySource({}),
        hs256_secret=None,
    )
    app.dependency_overrides[get_token_verifier] = lambda: no_secret
    token = make_token(key=TEST_HS256_SECRET, algorithm="HS256")
    _assert_unauthorized(await client.get(ME, headers=_bearer(token)))


class _UnreachableJwks:
    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        raise jwt.PyJWKClientConnectionError("connection refused")


async def test_jwks_outage_is_503_not_401(
    app: FastAPI, client: httpx.AsyncClient, make_token: TokenFactory
) -> None:
    outage = TokenVerifier(
        audience="authenticated", issuer=None, key_source=_UnreachableJwks(), hs256_secret=None
    )
    app.dependency_overrides[get_token_verifier] = lambda: outage
    response = await client.get(ME, headers=_bearer(make_token()))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "auth_unavailable"
