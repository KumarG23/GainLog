import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

PROVIDER = "openai-codex"
MODEL = "gpt-5.6-luna"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = MODEL
    messages: list[ChatMessage] = Field(min_length=1)
    max_tokens: int = Field(default=512, ge=1, le=2048)
    temperature: float | None = None


def generate_with_luna(prompt: str) -> str:
    from importlib import import_module

    call_llm = import_module("agent.auxiliary_client").call_llm

    response = call_llm(
        provider=PROVIDER,
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=512,
        timeout=120,
    )
    message = response.choices[0].message
    text = (getattr(message, "content", None) or "").strip()
    if not text:
        text = (getattr(message, "reasoning_content", None) or "").strip()
    if not text:
        raise RuntimeError("Luna returned an empty response")
    return text


def create_app(generate_fn: Callable[[str], str] | None = None) -> FastAPI:
    app = FastAPI(title="GainLog Luna Coach Proxy", docs_url=None, redoc_url=None)
    generator = generate_fn or generate_with_luna
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
            text = generator(prompt)
        except Exception as exc:
            with stats_lock:
                stats["failures"] += 1
            raise HTTPException(status_code=502, detail="Luna inference failed") from exc
        with stats_lock:
            stats["successes"] += 1

        return {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ],
        }

    return app


app = create_app()
