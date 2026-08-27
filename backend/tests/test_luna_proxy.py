from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.luna_proxy import create_app, generate_with_model


def test_luna_proxy_requires_auth_and_returns_openai_shape(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROXY_KEY", "test-secret")
    app = create_app(
        generate_fn=lambda prompt, model: SimpleNamespace(
            text=f"Luna reviewed: {prompt}",
            model="gpt-5.6-luna",
        )
    )
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
    app = create_app(
        generate_fn=lambda prompt, model: SimpleNamespace(text=prompt, model=model)
    )
    client = TestClient(app)

    response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={"messages": []},
    )

    assert response.status_code == 422


def test_luna_proxy_honors_sol_and_rejects_unapproved_models(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROXY_KEY", "test-secret")
    calls = []

    def generate(*args):
        calls.append(args)
        return SimpleNamespace(
            text="Sol reviewed the completed week.",
            model="gpt-5.6-sol",
        )

    client = TestClient(create_app(generate_fn=generate))
    sol_response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "model": "gpt-5.6-sol",
            "messages": [{"role": "user", "content": "Review the week"}],
        },
    )

    assert sol_response.status_code == 200
    assert sol_response.json()["model"] == "gpt-5.6-sol"
    assert calls == [("Review the week", "gpt-5.6-sol")]

    rejected = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "model": "arbitrary-model",
            "messages": [{"role": "user", "content": "Review the week"}],
        },
    )
    assert rejected.status_code == 422


def test_luna_proxy_fails_closed_when_actual_model_differs(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROXY_KEY", "test-secret")
    client = TestClient(
        create_app(
            generate_fn=lambda prompt, model: SimpleNamespace(
                text="Fallback output must not be relabeled.",
                model="gpt-5.6-luna",
            )
        )
    )

    response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "model": "gpt-5.6-sol",
            "messages": [{"role": "user", "content": "Review the week"}],
        },
    )

    assert response.status_code == 502
    assert client.get("/health").json()["failures"] == 1


def test_generate_with_model_rejects_an_internal_fallback(monkeypatch):
    def fake_call_llm(**kwargs):
        route_info = kwargs.get("route_info")
        assert route_info is not None
        route_info.update(provider="openai-codex", model="gpt-5.6-luna")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Fallback", reasoning_content=None))]
        )

    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: SimpleNamespace(call_llm=fake_call_llm),
    )

    with pytest.raises(RuntimeError, match="Unexpected coach route"):
        generate_with_model("Review the week", "gpt-5.6-sol")
