import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from tests.conftest import TokenFactory

URL = "/v1/saved-items"
ALICE, BOB = "alice-user-id", "bob-user-id"
Auth = Callable[[str], dict[str, str]]


@pytest.fixture
def auth(make_token: TokenFactory) -> Auth:
    return lambda user_id: {"Authorization": f"Bearer {make_token(sub=user_id)}"}


async def _save(client: httpx.AsyncClient, auth: Auth, user: str, **body: Any) -> Any:
    payload = {"url": "https://shop.example/jacket", "title": "Rain jacket", **body}
    response = await client.post(URL, json=payload, headers=auth(user))
    assert response.status_code == 201, response.text
    return response.json()


async def test_save_and_list(db_client: httpx.AsyncClient, auth: Auth) -> None:
    item = await _save(db_client, auth, ALICE)
    assert item["url"] == "https://shop.example/jacket"
    assert item["title"] == "Rain jacket"
    uuid.UUID(item["id"])

    page = (await db_client.get(URL, headers=auth(ALICE))).json()
    assert page["total"] == 1
    assert page["items"] == [item]


async def test_title_is_optional_and_trimmed(db_client: httpx.AsyncClient, auth: Auth) -> None:
    assert (await _save(db_client, auth, ALICE, title=None))["title"] is None
    trimmed = await _save(db_client, auth, ALICE, url="https://shop.example/b", title="  Boots ")
    assert trimmed["title"] == "Boots"


async def test_saving_same_url_twice_returns_existing(
    db_client: httpx.AsyncClient, auth: Auth
) -> None:
    first = await _save(db_client, auth, ALICE)
    second = await _save(db_client, auth, ALICE, title="Different title")
    assert second["id"] == first["id"]
    assert (await db_client.get(URL, headers=auth(ALICE))).json()["total"] == 1


async def test_same_url_for_different_users(db_client: httpx.AsyncClient, auth: Auth) -> None:
    a = await _save(db_client, auth, ALICE)
    b = await _save(db_client, auth, BOB)
    assert a["id"] != b["id"]


async def test_list_only_own_items_newest_first(db_client: httpx.AsyncClient, auth: Auth) -> None:
    for n in range(3):
        await _save(db_client, auth, ALICE, url=f"https://shop.example/{n}")
    await _save(db_client, auth, BOB, url="https://shop.example/bob")

    page = (await db_client.get(f"{URL}?limit=2", headers=auth(ALICE))).json()
    assert page["total"] == 3
    assert [i["url"] for i in page["items"]] == ["https://shop.example/2", "https://shop.example/1"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"url": "javascript:alert(1)"}, id="javascript-url"),
        pytest.param({"url": "chrome-extension://abc/popup.html"}, id="extension-url"),
        pytest.param({"url": "file:///etc/passwd"}, id="file-url"),
        pytest.param({"url": "not a url"}, id="garbage"),
        pytest.param({"url": "https://x.example/" + "a" * 2100}, id="too-long"),
        pytest.param({"url": "https://x.example", "title": "t" * 301}, id="title-too-long"),
        pytest.param({"title": "no url"}, id="missing-url"),
        pytest.param({"url": "https://x.example", "user_id": BOB}, id="extra-field"),
    ],
)
async def test_validation(db_client: httpx.AsyncClient, auth: Auth, body: dict[str, Any]) -> None:
    response = await db_client.post(URL, json=body, headers=auth(ALICE))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_delete_own_item(db_client: httpx.AsyncClient, auth: Auth) -> None:
    item = await _save(db_client, auth, ALICE)
    response = await db_client.delete(f"{URL}/{item['id']}", headers=auth(ALICE))
    assert response.status_code == 204
    assert (await db_client.get(URL, headers=auth(ALICE))).json()["total"] == 0


async def test_cannot_delete_other_users_item(db_client: httpx.AsyncClient, auth: Auth) -> None:
    item = await _save(db_client, auth, ALICE)
    response = await db_client.delete(f"{URL}/{item['id']}", headers=auth(BOB))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "saved_item_not_found"
    assert (await db_client.get(URL, headers=auth(ALICE))).json()["total"] == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", URL), ("POST", URL), ("DELETE", f"{URL}/{uuid.uuid4()}")],
)
async def test_requires_auth(db_client: httpx.AsyncClient, method: str, path: str) -> None:
    response = await db_client.request(method, path, json={"url": "https://x.example"})
    assert response.status_code == 401
