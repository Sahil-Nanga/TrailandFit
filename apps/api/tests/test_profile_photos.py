import io
import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api import photos as photos_api
from app.estimation.types import BodyScan, RGBImage
from tests import synthetic_body as body
from tests.conftest import FakePhotoStore, TokenFactory

ALICE, BOB = "alice-user-id", "bob-user-id"
Auth = Callable[[str], dict[str, str]]


class Detector:
    def __init__(self) -> None:
        self.scans = [body.front_scan(), body.side_scan()]

    def detect(self, image: RGBImage) -> BodyScan | None:
        return self.scans.pop(0)


@pytest.fixture(autouse=True)
def _setup(db_app: FastAPI) -> None:
    photos_api._limiter = None
    db_app.dependency_overrides[photos_api.get_pose_detector] = Detector


@pytest.fixture
def auth(make_token: TokenFactory) -> Auth:
    return lambda user_id: {"Authorization": f"Bearer {make_token(sub=user_id)}"}


def _jpeg_with_gps() -> bytes:
    exif = Image.Exif()
    exif[0x8825] = {2: (65.0, 1.0, 0.0)}  # GPS latitude (Oulu-ish): must never be stored
    exif[0x010F] = "PhoneMaker"
    buffer = io.BytesIO()
    Image.new("RGB", (600, 1000), (180, 180, 180)).save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


async def _estimate(
    client: httpx.AsyncClient, auth: Auth, user: str, keep: bool, side: bool = True
) -> Any:
    files: dict[str, Any] = {"front_photo": ("f.jpg", _jpeg_with_gps(), "image/jpeg")}
    if side:
        files["side_photo"] = ("s.jpg", _jpeg_with_gps(), "image/jpeg")
    data = {"height_cm": "175", "consent": "true", "keep_photos": "true" if keep else "false"}
    response = await client.post("/v1/photos/estimate", headers=auth(user), data=data, files=files)
    assert response.status_code == 200, response.text
    return response.json()


async def _create_profile(
    client: httpx.AsyncClient, auth: Auth, user: str, photo_ids: list[str]
) -> httpx.Response:
    body_ = {
        "name": "From photo",
        "measurements": {"height_cm": 175},
        "source": "photo",
        "photo_ids": photo_ids,
    }
    return await client.post("/v1/profiles", json=body_, headers=auth(user))


async def test_not_opting_in_stores_nothing(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore
) -> None:
    result = await _estimate(db_client, auth, ALICE, keep=False)
    assert result["kept_photo_ids"] == []
    assert photo_store.objects == {}


async def test_kept_photos_are_stored_without_metadata(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore
) -> None:
    result = await _estimate(db_client, auth, ALICE, keep=True)
    assert len(result["kept_photo_ids"]) == 2
    assert len(photo_store.objects) == 2
    for key, data in photo_store.objects.items():
        assert key.startswith(f"{ALICE}/")
        stored = Image.open(io.BytesIO(data))
        assert stored.format == "JPEG"
        assert dict(stored.getexif()) == {}  # no GPS, no camera details


async def test_attach_list_and_delete_photos(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore
) -> None:
    ids = (await _estimate(db_client, auth, ALICE, keep=True))["kept_photo_ids"]
    profile = (await _create_profile(db_client, auth, ALICE, ids)).json()

    listed = (
        await db_client.get(f"/v1/profiles/{profile['id']}/photos", headers=auth(ALICE))
    ).json()
    assert sorted(p["kind"] for p in listed) == ["front", "side"]
    assert all(p["url"].startswith("https://storage.test/sign/") for p in listed)

    response = await db_client.delete(f"/v1/profiles/{profile['id']}/photos", headers=auth(ALICE))
    assert response.status_code == 204
    assert photo_store.objects == {}
    assert (
        await db_client.get(f"/v1/profiles/{profile['id']}/photos", headers=auth(ALICE))
    ).json() == []
    # The measurements stay.
    assert (
        await db_client.get(f"/v1/profiles/{profile['id']}", headers=auth(ALICE))
    ).status_code == 200


async def test_deleting_profile_deletes_its_photos(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore
) -> None:
    ids = (await _estimate(db_client, auth, ALICE, keep=True))["kept_photo_ids"]
    profile = (await _create_profile(db_client, auth, ALICE, ids)).json()
    assert (
        await db_client.delete(f"/v1/profiles/{profile['id']}", headers=auth(ALICE))
    ).status_code == 204
    assert photo_store.objects == {}


async def test_photos_are_private_to_their_owner(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore
) -> None:
    ids = (await _estimate(db_client, auth, ALICE, keep=True))["kept_photo_ids"]
    stolen = await _create_profile(db_client, auth, BOB, ids)
    assert stolen.status_code == 422
    assert stolen.json()["error"]["code"] == "photos_not_found"

    profile = (await _create_profile(db_client, auth, ALICE, ids)).json()
    url = f"/v1/profiles/{profile['id']}/photos"
    assert (await db_client.get(url, headers=auth(BOB))).status_code == 404
    assert (await db_client.delete(url, headers=auth(BOB))).status_code == 404
    assert len(photo_store.objects) == 2


async def test_photos_attach_only_once(db_client: httpx.AsyncClient, auth: Auth) -> None:
    ids = (await _estimate(db_client, auth, ALICE, keep=True))["kept_photo_ids"]
    assert (await _create_profile(db_client, auth, ALICE, ids)).status_code == 201
    assert (await _create_profile(db_client, auth, ALICE, ids)).status_code == 422


async def test_unknown_photo_ids_rejected(db_client: httpx.AsyncClient, auth: Auth) -> None:
    response = await _create_profile(db_client, auth, ALICE, [str(uuid.uuid4())])
    assert response.status_code == 422


async def test_stale_unattached_photos_are_purged(
    db_client: httpx.AsyncClient, auth: Auth, photo_store: FakePhotoStore, database_url: str
) -> None:
    old = (await _estimate(db_client, auth, ALICE, keep=True, side=False))["kept_photo_ids"]
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE profile_photos SET created_at = now() - interval '2 hours'")
        )
    await engine.dispose()

    await _estimate(db_client, auth, ALICE, keep=True, side=False)  # triggers the purge
    assert len(photo_store.objects) == 1
    assert (await _create_profile(db_client, auth, ALICE, old)).status_code == 422


async def test_keeping_without_storage_is_refused(
    db_app: FastAPI, db_client: httpx.AsyncClient, auth: Auth
) -> None:
    from app.api.deps import get_photo_store

    db_app.dependency_overrides[get_photo_store] = lambda: None
    files = {"front_photo": ("f.jpg", _jpeg_with_gps(), "image/jpeg")}
    data = {"height_cm": "175", "consent": "true", "keep_photos": "true"}
    response = await db_client.post(
        "/v1/photos/estimate", headers=auth(ALICE), data=data, files=files
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "photo_storage_unavailable"


async def test_photo_endpoints_require_auth(db_client: httpx.AsyncClient) -> None:
    url = f"/v1/profiles/{uuid.uuid4()}/photos"
    assert (await db_client.get(url)).status_code == 401
    assert (await db_client.delete(url)).status_code == 401
