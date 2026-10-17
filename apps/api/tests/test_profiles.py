import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import TokenFactory

ALICE = "alice-user-id"
BOB = "bob-user-id"

Auth = Callable[[str], dict[str, str]]


@pytest.fixture
def auth(make_token: TokenFactory) -> Auth:
    return lambda user_id: {"Authorization": f"Bearer {make_token(sub=user_id)}"}


def _body(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "name": "Everyday",
        "measurements": {"height_cm": 175, "chest_cm": 98.5, "waist_cm": 82},
    }
    data.update(overrides)
    return data


async def _create(client: httpx.AsyncClient, auth: Auth, user: str, **overrides: Any) -> Any:
    response = await client.post("/v1/profiles", json=_body(**overrides), headers=auth(user))
    assert response.status_code == 201, response.text
    return response.json()


# --- create -------------------------------------------------------------------------------


async def test_create_manual_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    profile = await _create(db_client, auth, ALICE)
    assert profile["user_id"] == ALICE
    assert profile["name"] == "Everyday"
    assert profile["source"] == "manual"
    assert profile["confidence"] is None
    assert profile["measurements"]["height_cm"] == 175
    assert profile["measurements"]["hips_cm"] is None
    uuid.UUID(profile["id"])
    assert profile["created_at"] and profile["updated_at"]


async def test_create_uses_default_name(db_client: httpx.AsyncClient, auth: Auth) -> None:
    body = {"measurements": {"height_cm": 160}}
    response = await db_client.post("/v1/profiles", json=body, headers=auth(ALICE))
    assert response.status_code == 201
    assert response.json()["name"] == "My measurements"


async def test_create_photo_profile_keeps_confidence(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    profile = await _create(
        db_client, auth, ALICE, source="photo", confidence={"chest_cm": 0.8, "waist_cm": 0.35}
    )
    assert profile["source"] == "photo"
    assert profile["confidence"] == {"chest_cm": 0.8, "waist_cm": 0.35}


async def test_create_requires_auth(db_client: httpx.AsyncClient) -> None:
    response = await db_client.post("/v1/profiles", json=_body())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"measurements": {"height_cm": 3}}, id="height-3cm"),
        pytest.param({"measurements": {"chest_cm": 100}}, id="missing-height"),
        pytest.param({"name": "   "}, id="blank-name"),
        pytest.param({"source": "guess"}, id="unknown-source"),
        pytest.param({"confidence": {"chest_cm": 0.5}}, id="manual-with-confidence"),
        pytest.param({"user_id": BOB}, id="client-sets-user-id"),
    ],
)
async def test_create_validation(
    db_client: httpx.AsyncClient, auth: Auth, overrides: dict[str, Any]
) -> None:
    response = await db_client.post("/v1/profiles", json=_body(**overrides), headers=auth(ALICE))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --- list ---------------------------------------------------------------------------------


async def test_list_only_returns_own_profiles(db_client: httpx.AsyncClient, auth: Auth) -> None:
    await _create(db_client, auth, ALICE, name="A1")
    await _create(db_client, auth, BOB, name="B1")

    response = await db_client.get("/v1/profiles", headers=auth(ALICE))
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 1
    assert [p["name"] for p in page["items"]] == ["A1"]


async def test_list_empty(db_client: httpx.AsyncClient, auth: Auth) -> None:
    response = await db_client.get("/v1/profiles", headers=auth(ALICE))
    assert response.json() == {"items": [], "total": 0, "limit": 20, "offset": 0}


async def test_list_paginates_newest_first(db_client: httpx.AsyncClient, auth: Auth) -> None:
    for name in ["first", "second", "third"]:
        await _create(db_client, auth, ALICE, name=name)

    page1 = (await db_client.get("/v1/profiles?limit=2", headers=auth(ALICE))).json()
    page2 = (await db_client.get("/v1/profiles?limit=2&offset=2", headers=auth(ALICE))).json()
    assert [p["name"] for p in page1["items"]] == ["third", "second"]
    assert [p["name"] for p in page2["items"]] == ["first"]
    assert page1["total"] == page2["total"] == 3


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
async def test_list_rejects_bad_pagination(
    db_client: httpx.AsyncClient, auth: Auth, query: str
) -> None:
    response = await db_client.get(f"/v1/profiles?{query}", headers=auth(ALICE))
    assert response.status_code == 422


async def test_list_requires_auth(db_client: httpx.AsyncClient) -> None:
    assert (await db_client.get("/v1/profiles")).status_code == 401


# --- get ----------------------------------------------------------------------------------


async def test_get_own_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.get(f"/v1/profiles/{created['id']}", headers=auth(ALICE))
    assert response.status_code == 200
    assert response.json() == created


async def test_get_other_users_profile_is_404(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.get(f"/v1/profiles/{created['id']}", headers=auth(BOB))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "profile_not_found"


async def test_get_missing_profile_is_404(db_client: httpx.AsyncClient, auth: Auth) -> None:
    response = await db_client.get(f"/v1/profiles/{uuid.uuid4()}", headers=auth(ALICE))
    assert response.status_code == 404


async def test_get_invalid_id_is_422(db_client: httpx.AsyncClient, auth: Auth) -> None:
    response = await db_client.get("/v1/profiles/not-a-uuid", headers=auth(ALICE))
    assert response.status_code == 422


async def test_get_requires_auth(db_client: httpx.AsyncClient) -> None:
    assert (await db_client.get(f"/v1/profiles/{uuid.uuid4()}")).status_code == 401


# --- update -------------------------------------------------------------------------------


async def test_rename(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.patch(
        f"/v1/profiles/{created['id']}", json={"name": "  Gym  "}, headers=auth(ALICE)
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Gym"
    assert updated["measurements"] == created["measurements"]
    assert updated["updated_at"] > created["updated_at"]


async def test_measurements_are_replaced_as_a_whole(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.patch(
        f"/v1/profiles/{created['id']}",
        json={"measurements": {"height_cm": 176, "hips_cm": 99}},
        headers=auth(ALICE),
    )
    measurements = response.json()["measurements"]
    assert measurements["height_cm"] == 176
    assert measurements["hips_cm"] == 99
    assert measurements["chest_cm"] is None  # omitted fields are cleared


async def test_editing_photo_values_marks_profile_edited(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    created = await _create(db_client, auth, ALICE, source="photo", confidence={"chest_cm": 0.7})
    url = f"/v1/profiles/{created['id']}"

    same = {"measurements": created["measurements"]}
    unchanged = (await db_client.patch(url, json=same, headers=auth(ALICE))).json()
    assert unchanged["source"] == "photo"

    edited_values = {**created["measurements"], "chest_cm": 101}
    edited = (
        await db_client.patch(url, json={"measurements": edited_values}, headers=auth(ALICE))
    ).json()
    assert edited["source"] == "photo_edited"
    assert edited["confidence"] == {"chest_cm": 0.7}


async def test_manual_profile_stays_manual_after_edit(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.patch(
        f"/v1/profiles/{created['id']}",
        json={"measurements": {"height_cm": 180}},
        headers=auth(ALICE),
    )
    assert response.json()["source"] == "manual"


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="empty"),
        pytest.param({"name": None}, id="null-name"),
        pytest.param({"measurements": None}, id="null-measurements"),
        pytest.param({"measurements": {"height_cm": 3}}, id="out-of-range"),
        pytest.param({"source": "manual"}, id="client-sets-source"),
    ],
)
async def test_update_validation(
    db_client: httpx.AsyncClient, auth: Auth, body: dict[str, Any]
) -> None:
    created = await _create(db_client, auth, ALICE)
    response = await db_client.patch(
        f"/v1/profiles/{created['id']}", json=body, headers=auth(ALICE)
    )
    assert response.status_code == 422


async def test_cannot_update_other_users_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    url = f"/v1/profiles/{created['id']}"
    response = await db_client.patch(url, json={"name": "hijacked"}, headers=auth(BOB))
    assert response.status_code == 404
    assert (await db_client.get(url, headers=auth(ALICE))).json()["name"] == "Everyday"


async def test_update_requires_auth(db_client: httpx.AsyncClient) -> None:
    response = await db_client.patch(f"/v1/profiles/{uuid.uuid4()}", json={"name": "x"})
    assert response.status_code == 401


# --- delete -------------------------------------------------------------------------------


async def test_delete_own_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    url = f"/v1/profiles/{created['id']}"
    response = await db_client.delete(url, headers=auth(ALICE))
    assert response.status_code == 204
    assert response.content == b""
    assert (await db_client.get(url, headers=auth(ALICE))).status_code == 404


async def test_cannot_delete_other_users_profile(db_client: httpx.AsyncClient, auth: Auth) -> None:
    created = await _create(db_client, auth, ALICE)
    url = f"/v1/profiles/{created['id']}"
    assert (await db_client.delete(url, headers=auth(BOB))).status_code == 404
    assert (await db_client.get(url, headers=auth(ALICE))).status_code == 200


async def test_delete_requires_auth(db_client: httpx.AsyncClient) -> None:
    assert (await db_client.delete(f"/v1/profiles/{uuid.uuid4()}")).status_code == 401


# --- database constraints (defense in depth) ----------------------------------------------


@pytest.mark.parametrize(
    ("column", "value"),
    [("height_cm", 3), ("waist_cm", 820), ("source", "'guess'"), ("name", "'   '")],
)
async def test_database_rejects_invalid_rows(database_url: str, column: str, value: object) -> None:
    row = {
        "id": f"'{uuid.uuid4()}'",
        "user_id": "'x'",
        "name": "'n'",
        "height_cm": 170,
        "source": "'manual'",
    }
    row[column] = str(value)
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await conn.execute(
                    text(
                        f"INSERT INTO measurement_profiles ({', '.join(row)}) "  # noqa: S608
                        f"VALUES ({', '.join(str(v) for v in row.values())})"
                    )
                )
    finally:
        await engine.dispose()
