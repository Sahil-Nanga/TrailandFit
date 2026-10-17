from fastapi.testclient import TestClient

from body_fit.main import app

client = TestClient(app)


def test_fit_endpoint() -> None:
    body = {
        "measurements": {"height_cm": 179, "weight_kg": 74, "chest_cm": 98, "waist_cm": 84},
        "body_type": 0.8,
    }
    response = client.post("/fit", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["within_tolerance"] is True
    assert set(data["residuals_cm"]) == {"chest", "waist"}
    assert data["measured_cm"]["height"] == 179
    assert all(0 <= w <= 1 for w in data["weights"].values())
    assert "female" in data["weights"] and "waist-incr" in data["weights"]


def test_validation() -> None:
    assert client.post("/fit", json={"measurements": {"height_cm": 3}}).status_code == 422
    assert (
        client.post("/fit", json={"measurements": {"height_cm": 175}, "body_type": 2}).status_code
        == 422
    )
    assert client.post("/fit", json={}).status_code == 422


def test_cors_allows_the_modeler_only() -> None:
    ok = client.options(
        "/fit", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}
    )
    bad = client.options(
        "/fit", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert ok.status_code == 200
    assert bad.status_code == 400
