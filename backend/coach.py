import logging
import os
from dataclasses import dataclass
from typing import Protocol

import requests

logger = logging.getLogger(__name__)


class CoachProvider(Protocol):
    def generate(self, prompt: str) -> str:
        ...


@dataclass
class OllamaCoachProvider:
    base_url: str
    model: str
    timeout_seconds: int = 60

    def generate(self, prompt: str) -> str:
        url = f"{self.base_url.rstrip('/')}/api/generate"
        response = requests.post(
            url,
            json={
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.4,
                    "num_predict": 256,
                },
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        text = data.get("response", "").strip()
        if not text:
            raise RuntimeError("Ollama returned an empty coaching response")
        return text


@dataclass
class OpenAICompatibleCoachProvider:
    base_url: str
    api_key: str
    model: str
    timeout_seconds: int = 120

    def generate(self, prompt: str) -> str:
        response = requests.post(
            f"{self.base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 512,
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        try:
            text = data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise RuntimeError("Coach proxy returned an invalid response") from exc
        if not text:
            raise RuntimeError("Coach proxy returned an empty response")
        return text


@dataclass
class FallbackCoachProvider:
    primary: CoachProvider
    fallback: CoachProvider

    def generate(self, prompt: str) -> str:
        try:
            return self.primary.generate(prompt)
        except Exception as exc:
            logger.warning("Primary coach unavailable; using local fallback: %s", exc)
            return self.fallback.generate(prompt)


@dataclass
class AnthropicCoachProvider:
    api_key: str
    model: str = "claude-sonnet-4-20250514"

    def generate(self, prompt: str) -> str:
        import anthropic

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model=self.model,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()
        if not text:
            raise RuntimeError("Anthropic returned an empty coaching response")
        return text


def get_coach_provider(
    *,
    model_env_var: str = "GAINLOG_COACH_MODEL",
    default_model: str = "gpt-5.6-luna",
) -> CoachProvider:
    provider = os.environ.get("GAINLOG_COACH_PROVIDER", "ollama").strip().lower()

    if provider == "ollama":
        base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
        timeout_seconds = int(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "60"))
        return OllamaCoachProvider(
            base_url=base_url,
            model=model,
            timeout_seconds=timeout_seconds,
        )

    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is required when GAINLOG_COACH_PROVIDER=anthropic")
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        return AnthropicCoachProvider(api_key=api_key, model=model)

    if provider == "luna":
        base_url = os.environ.get("GAINLOG_COACH_BASE_URL")
        api_key = os.environ.get("GAINLOG_COACH_API_KEY")
        if not base_url or not api_key:
            raise RuntimeError(
                "GAINLOG_COACH_BASE_URL and GAINLOG_COACH_API_KEY are required "
                "when GAINLOG_COACH_PROVIDER=luna"
            )
        primary = OpenAICompatibleCoachProvider(
            base_url=base_url,
            api_key=api_key,
            model=os.environ.get(model_env_var, default_model),
            timeout_seconds=int(os.environ.get("GAINLOG_COACH_TIMEOUT_SECONDS", "120")),
        )
        if os.environ.get("GAINLOG_COACH_FALLBACK", "ollama").strip().lower() == "ollama":
            fallback = OllamaCoachProvider(
                base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
                model=os.environ.get("OLLAMA_MODEL", "qwen2.5:7b"),
                timeout_seconds=int(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "60")),
            )
            return FallbackCoachProvider(primary=primary, fallback=fallback)
        return primary

    raise RuntimeError(f"Unsupported GAINLOG_COACH_PROVIDER: {provider}")
