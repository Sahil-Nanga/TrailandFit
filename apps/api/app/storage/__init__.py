"""Private object storage for photos users chose to keep (Supabase Storage).

Objects are never public: callers get short-lived signed URLs. Keys, URLs and contents are
never logged.
"""

from typing import Protocol

import httpx


class StorageError(Exception):
    pass


class PhotoStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def signed_url(self, key: str, expires_in: int) -> str: ...

    async def delete(self, keys: list[str]) -> None: ...


class SupabasePhotoStore:
    def __init__(self, base_url: str, secret_key: str, bucket: str) -> None:
        self._storage = f"{base_url.rstrip('/')}/storage/v1"
        self._bucket = bucket
        self._client = httpx.AsyncClient(
            headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}"},
            timeout=httpx.Timeout(20.0),
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        response = await self._client.post(
            f"{self._storage}/object/{self._bucket}/{key}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "false"},
        )
        if response.status_code >= 400:
            raise StorageError(f"upload failed ({response.status_code})")

    async def signed_url(self, key: str, expires_in: int) -> str:
        response = await self._client.post(
            f"{self._storage}/object/sign/{self._bucket}/{key}", json={"expiresIn": expires_in}
        )
        if response.status_code >= 400:
            raise StorageError(f"signing failed ({response.status_code})")
        path = str(response.json()["signedURL"])
        return f"{self._storage}{path}" if path.startswith("/") else path

    async def delete(self, keys: list[str]) -> None:
        if not keys:
            return
        response = await self._client.request(
            "DELETE", f"{self._storage}/object/{self._bucket}", json={"prefixes": keys}
        )
        if response.status_code >= 400:
            raise StorageError(f"delete failed ({response.status_code})")

    async def aclose(self) -> None:
        await self._client.aclose()
