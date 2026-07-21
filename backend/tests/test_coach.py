import pytest

from backend.coach import (
    FallbackCoachProvider,
    OllamaCoachProvider,
    OpenAICompatibleCoachProvider,
    get_coach_provider,
)


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


def test_luna_provider_uses_proxy_with_ollama_fallback(monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "luna")
    monkeypatch.setenv("GAINLOG_COACH_BASE_URL", "http://hermes:8646/v1")
    monkeypatch.setenv("GAINLOG_COACH_API_KEY", "proxy-secret")
    monkeypatch.setenv("GAINLOG_COACH_MODEL", "gpt-5.6-luna")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ai-box:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "gemma3:12b")

    provider = get_coach_provider()

    assert isinstance(provider, FallbackCoachProvider)
    assert isinstance(provider.primary, OpenAICompatibleCoachProvider)
    assert provider.primary.base_url == "http://hermes:8646/v1"
    assert provider.primary.api_key == "proxy-secret"
    assert provider.primary.model == "gpt-5.6-luna"
    assert isinstance(provider.fallback, OllamaCoachProvider)
    assert provider.fallback.model == "gemma3:12b"


def test_openai_compatible_generate(monkeypatch):
    calls = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {"message": {"content": "Luna sees the whole day clearly."}}
                ]
            }

    def fake_post(url, headers, json, timeout):
        calls.update(url=url, headers=headers, json=json, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr("backend.coach.requests.post", fake_post)
    provider = OpenAICompatibleCoachProvider(
        base_url="http://hermes:8646/v1",
        api_key="proxy-secret",
        model="gpt-5.6-luna",
        timeout_seconds=90,
    )

    result = provider.generate("review my day")

    assert result == "Luna sees the whole day clearly."
    assert calls["url"] == "http://hermes:8646/v1/chat/completions"
    assert calls["headers"]["Authorization"] == "Bearer proxy-secret"
    assert calls["json"]["model"] == "gpt-5.6-luna"
    assert calls["json"]["messages"] == [
        {"role": "user", "content": "review my day"}
    ]
    assert calls["timeout"] == 90


def test_fallback_provider_uses_local_when_primary_fails():
    class BrokenPrimary:
        def generate(self, prompt):
            raise RuntimeError("subscription unavailable")

    class WorkingFallback:
        def generate(self, prompt):
            return f"local fallback: {prompt}"

    provider = FallbackCoachProvider(BrokenPrimary(), WorkingFallback())

    assert provider.generate("coach me") == "local fallback: coach me"


def test_coach_status_does_not_claim_default_ollama_is_configured(client, monkeypatch):
    monkeypatch.delenv("GAINLOG_COACH_PROVIDER", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)

    response = client.get("/coach/status")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "ollama",
        "model": "qwen2.5:7b",
        "baseUrl": "http://localhost:11434",
        "configured": False,
    }


def test_coach_status_reports_luna_proxy_configuration(client, monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "luna")
    monkeypatch.setenv("GAINLOG_COACH_BASE_URL", "http://hermes:8646/v1")
    monkeypatch.setenv("GAINLOG_COACH_API_KEY", "proxy-secret")
    monkeypatch.setenv("GAINLOG_COACH_MODEL", "gpt-5.6-luna")

    response = client.get("/coach/status")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "luna",
        "model": "gpt-5.6-luna",
        "baseUrl": "http://hermes:8646/v1",
        "configured": True,
    }


def test_coach_status_reports_explicit_ollama_configuration(client, monkeypatch):
    monkeypatch.setenv("GAINLOG_COACH_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ai-box:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "gemma3:12b")

    response = client.get("/coach/status")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "ollama",
        "model": "gemma3:12b",
        "baseUrl": "http://ai-box:11434",
        "configured": True,
    }
