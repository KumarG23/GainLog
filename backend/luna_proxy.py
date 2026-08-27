import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

PROVIDER = "openai-codex"
MODEL = "gpt-5.6-luna"
AllowedModel = Literal["gpt-5.6-luna", "gpt-5.6-sol"]


@dataclass(frozen=True)
class GenerationResult:
    text: str
    model: AllowedModel


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: AllowedModel = MODEL
    messages: list[ChatMessage] = Field(min_length=1)
    max_tokens: int = Field(default=512, ge=1, le=2048)
    temperature: float | None = None


def generate_with_model(prompt: str, model: AllowedModel) -> GenerationResult:
    from importlib import import_module

    call_llm = import_module("agent.auxiliary_client").call_llm

    route_info: dict[str, str] = {}
    response = call_llm(
        provider=PROVIDER,
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=512,
        timeout=120,
        route_info=route_info,
    )
    if route_info.get("provider") != PROVIDER or route_info.get("model") != model:
        raise RuntimeError("Unexpected coach route")
    message = response.choices[0].message
    text = (getattr(message, "content", None) or "").strip()
    if not text:
        text = (getattr(message, "reasoning_content", None) or "").strip()
    if not text:
        raise RuntimeError("Coach model returned an empty response")
    return GenerationResult(text=text, model=model)


def create_app(
    generate_fn: Callable[[str, AllowedModel], GenerationResult] | None = None,
) -> FastAPI:
    app = FastAPI(title="GainLog Luna Coach Proxy", docs_url=None, redoc_url=None)
    generator = generate_fn or generate_with_model
    stats = {"requests": 0, "successes": 0, "failures": 0}
    stats_lock = threading.Lock()

    @app.get("/health")
    def health():
        with stats_lock:
            counters = dict(stats)
        return {
            "status": "ok",
            "provider": PROVIDER,
            "model": MODEL,
            **counters,
        }

    @app.post("/v1/chat/completions")
    def chat_completions(
        request: ChatCompletionRequest,
        authorization: str | None = Header(default=None),
    ):
        expected_key = os.environ.get("GAINLOG_COACH_PROXY_KEY", "")
        supplied_key = ""
        if authorization and authorization.startswith("Bearer "):
            supplied_key = authorization.removeprefix("Bearer ").strip()
        if not expected_key or not secrets.compare_digest(supplied_key, expected_key):
            raise HTTPException(status_code=401, detail="Unauthorized")

        prompt = next(
            (
                message.content.strip()
                for message in reversed(request.messages)
                if message.role == "user" and message.content.strip()
            ),
            "",
        )
        if not prompt:
            raise HTTPException(status_code=422, detail="A non-empty user message is required")

        with stats_lock:
            stats["requests"] += 1
        try:
            result = generator(prompt, request.model)
            if result.model != request.model:
                raise RuntimeError("Unexpected coach route")
        except Exception as exc:
            with stats_lock:
                stats["failures"] += 1
            raise HTTPException(status_code=502, detail="Coach inference failed") from exc
        with stats_lock:
            stats["successes"] += 1

        return {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": result.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": result.text},
                    "finish_reason": "stop",
                }
            ],
        }

    return app


app = create_app()
