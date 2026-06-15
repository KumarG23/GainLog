import pytest

from backend.coach import OllamaCoachProvider, get_coach_provider


def test_default_provider_is_ollama(monkeypatch):
    monkeypatch.delenv("GAINLOG_COACH_PROVIDER", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)

    provider = get_coach_provider()

    assert isinstance(provider, OllamaCoachProvider)
    assert provider.base_url == "http://localhost:11434"
    assert provider.model == "qwen2.5:7b"


def test_ollama_provider_uses_env(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://example.local:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "llama3.1:8b")

    provider = get_coach_provider()

    assert isinstance(provider, OllamaCoachProvider)
    assert provider.base_url == "http://example.local:11434"
    assert provider.model == "llama3.1:8b"


def test_unsupported_provider_raises(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "bogus")

    with pytest.raises(RuntimeError, match="Unsupported"):
        get_coach_provider()


def test_anthropic_requires_api_key(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        get_coach_provider()


def test_ollama_generate(monkeypatch):
    calls = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"response": "Strong session. Add 5 lbs next time."}

    def fake_post(url, json, timeout):
        calls["url"] = url
        calls["json"] = json
        calls["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("backend.coach.requests.post", fake_post)

    provider = OllamaCoachProvider(
        base_url="http://ollama.local:11434",
        model="qwen2.5:7b",
        timeout_seconds=30,
    )

    result = provider.generate("coach me")

    assert result == "Strong session. Add 5 lbs next time."
    assert calls["url"] == "http://ollama.local:11434/api/generate"
    assert calls["json"]["model"] == "qwen2.5:7b"
    assert calls["json"]["prompt"] == "coach me"
    assert calls["json"]["stream"] is False
    assert calls["timeout"] == 30


def test_coach_status_defaults_to_ollama(client, monkeypatch):
    monkeypatch.delenv("GAINLOG_COACH_PROVIDER", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)

    response = client.get("/coach/status")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "ollama",
        "model": "qwen2.5:7b",
        "baseUrl": "http://localhost:11434",
        "configured": True,
    }
