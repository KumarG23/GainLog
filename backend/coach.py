import os
from dataclasses import dataclass
from typing import Protocol

import requests


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


def get_coach_provider() -> CoachProvider:
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

    raise RuntimeError(f"Unsupported GAINLOG_COACH_PROVIDER: {provider}")
