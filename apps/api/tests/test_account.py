from collections.abc import Callable
from typing import Any

import httpx
import pytest

from tests.conftest import TokenFactory

ALICE, BOB = "alice-user-id", "bob-user-id"
Auth = Callable[[str], dict[str, str]]
URL = "/v1/account/settings"


@pytest.fixture
def auth(make_token: TokenFactory) -> Auth:
    return lambda user_id: {"Authorization": f"Bearer {make_token(sub=user_id)}"}


async def _profile(client: httpx.AsyncClient, auth: Auth, user: str, name: str = "P") -> Any:
    body = {"name": name, "measurements": {"height_cm": 175}}
    response = await client.post("/v1/profiles", json=body, headers=auth(user))
    assert response.status_code == 201
    return response.json()


async def test_no_active_profile_by_default(db_client: httpx.AsyncClient, auth: Auth) -> None:
    response = await db_client.get(URL, headers=auth(ALICE))
    assert response.status_code == 200
    assert response.json() == {"active_profile_id": None}


async def test_set_and_read_active_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    profile = await _profile(db_client, auth, ALICE)
    response = await db_client.patch(
        URL, json={"active_profile_id": profile["id"]}, headers=auth(ALICE)
    )
    assert response.status_code == 200
    assert (await db_client.get(URL, headers=auth(ALICE))).json() == {
        "active_profile_id": profile["id"]
    }


async def test_cannot_select_someone_elses_profile(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    bobs = await _profile(db_client, auth, BOB)
    response = await db_client.patch(
        URL, json={"active_profile_id": bobs["id"]}, headers=auth(ALICE)
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "profile_not_found"
    assert (await db_client.get(URL, headers=auth(ALICE))).json() == {"active_profile_id": None}


async def test_deleting_active_profile_clears_it(db_client: httpx.AsyncClient, auth: Auth) -> None:
    profile = await _profile(db_client, auth, ALICE)
    await db_client.patch(URL, json={"active_profile_id": profile["id"]}, headers=auth(ALICE))
    await db_client.delete(f"/v1/profiles/{profile['id']}", headers=auth(ALICE))
    assert (await db_client.get(URL, headers=auth(ALICE))).json() == {"active_profile_id": None}


async def test_settings_are_per_user(db_client: httpx.AsyncClient, auth: Auth) -> None:
    profile = await _profile(db_client, auth, ALICE)
    await db_client.patch(URL, json={"active_profile_id": profile["id"]}, headers=auth(ALICE))
    assert (await db_client.get(URL, headers=auth(BOB))).json() == {"active_profile_id": None}


@pytest.mark.parametrize(
    "body", [{}, {"active_profile_id": "nope"}, {"active_profile_id": None, "x": 1}]
)
async def test_validation(db_client: httpx.AsyncClient, auth: Auth, body: dict[str, Any]) -> None:
    assert (await db_client.patch(URL, json=body, headers=auth(ALICE))).status_code == 422


@pytest.mark.parametrize("method", ["GET", "PATCH"])
async def test_requires_auth(db_client: httpx.AsyncClient, method: str) -> None:
    assert (
        await db_client.request(method, URL, json={"active_profile_id": None})
    ).status_code == 401
