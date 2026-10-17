import httpx


async def test_health_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_needs_no_auth(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/health", headers={"Authorization": "Bearer garbage"})
    assert response.status_code == 200


async def test_health_rejects_bad_query(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/health", params={"db": "not-a-bool"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_unknown_route_uses_error_shape(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


async def test_health_with_database(db_client: httpx.AsyncClient) -> None:
    response = await db_client.get("/v1/health", params={"db": "true"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
