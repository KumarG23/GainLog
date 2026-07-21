from fastapi.testclient import TestClient

from backend.luna_proxy import create_app


def test_luna_proxy_requires_auth_and_returns_openai_shape(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROXY_KEY", "test-secret")
    app = create_app(generate_fn=lambda prompt: f"Luna reviewed: {prompt}")
    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "provider": "openai-codex",
        "model": "gpt-5.6-luna",
        "requests": 0,
        "successes": 0,
        "failures": 0,
    }

    unauthorized = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "Review today"}]},
    )
    assert unauthorized.status_code == 401

    response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "model": "gpt-5.6-luna",
            "messages": [{"role": "user", "content": "Review today"}],
            "max_tokens": 256,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "gpt-5.6-luna"
    assert body["choices"][0]["message"] == {
        "role": "assistant",
        "content": "Luna reviewed: Review today",
    }
    assert client.get("/health").json()["requests"] == 1
    assert client.get("/health").json()["successes"] == 1
    assert client.get("/health").json()["failures"] == 0


def test_luna_proxy_rejects_empty_messages(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROXY_KEY", "test-secret")
    app = create_app(generate_fn=lambda prompt: prompt)
    client = TestClient(app)

    response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={"messages": []},
    )

    assert response.status_code == 422
