from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import re
import sys

import anyio
from anyio.streams.memory import MemoryObjectSendStream
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.shared.message import SessionMessage

from .models import (
    BodyCompositionRequest, BodyCompositionResult, CoverageResult, DailyHealthRequest,
    DailyHealthResult, GetWorkoutRequest, GoalsRequest, GoalsResult,
    ListWorkoutsRequest, NutritionRequest, NutritionResult, ReviewsRequest,
    ReviewsResult, WorkoutDetailResult, WorkoutListResult, EmptyRequest,
)
from .queries import query


MAX_FRAME_BYTES = 65536
MAX_RESULT_BYTES = 131072

TOOLS = {
    "get_data_coverage": (
        EmptyRequest, CoverageResult,
        "Describe exported domains, record/date coverage, source connection freshness and explicit omissions. Check stale and source semantics before conclusions.",
    ),
    "list_workouts": (
        ListWorkoutsRequest, WorkoutListResult,
        "List bounded workout-session summaries newest first, including strength/cardio metrics, feedback, notes, stored insight, and exercise/set counts. Date ranges contain at most 366 calendar dates; page with offset and honor explicit truncation guidance.",
    ),
    "get_workout": (
        GetWorkoutRequest, WorkoutDetailResult,
        "Get one workout by exact session_id with exercises and every persisted set; omit session_id to get the latest workout. This never creates or regenerates insight.",
    ),
    "query_nutrition": (
        NutritionRequest, NutritionResult,
        "Query persisted nutrition entries by exact entry_id or a bounded date range, preserving meal detail, calories, macros, fiber, notes, zero and null. Latest entries are returned when no selector is supplied.",
    ),
    "query_body_composition": (
        BodyCompositionRequest, BodyCompositionResult,
        "Query weight and body-composition history by exact entry_id or bounded date range, including source semantics and source record identifier. Null means unavailable; consumer body-composition estimates are not diagnosis.",
    ),
    "query_daily_health": (
        DailyHealthRequest, DailyHealthResult,
        "Query a precise day or bounded history for canonical reconciled daily sleep/activity/resting-HR/HRV metrics or persisted Google snapshots. Dataset and source_note distinguish reconciliation semantics; null is missing and zero is observed zero.",
    ),
    "query_goals": (
        GoalsRequest, GoalsResult,
        "Query persisted goals by exact goal_id or status, including target/minimum/maximum semantics, dates, units and notes. No goal changes are possible.",
    ),
    "query_saved_reviews": (
        ReviewsRequest, ReviewsResult,
        "Read only existing daily, weekly or trend review outputs by exact key or bounded generated/date range. Never calls a model, regenerates, refreshes or writes a cache.",
    ),
}

ERRORS = {"invalid_request", "not_found", "store_unavailable", "store_corrupt"}


def create_server(path: Path) -> Server:
    server = Server(
        "GainLog Read-only Health",
        version="0.1.0",
        instructions=(
            "Owner-authorized read-only personal health projection. No writes, sync, OAuth, "
            "regeneration, raw provider payloads, credentials, arbitrary SQL, paths, URLs, or "
            "network calls. Check coverage, freshness, nulls and source semantics. Do not diagnose."
        ),
    )

    @server.list_tools()
    async def list_tools():
        return [
            types.Tool(
                name=name,
                description=description,
                inputSchema=request.model_json_schema(),
                outputSchema=response.model_json_schema(),
                annotations=types.ToolAnnotations(
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=True,
                    openWorldHint=False,
                ),
            )
            for name, (request, response, description) in TOOLS.items()
        ]

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        try:
            if name not in TOOLS:
                result = {"error": "invalid_request"}
            else:
                result = query(path, name, arguments)
                if "error" not in result:
                    response_type = TOOLS[name][1]
                    result = response_type.model_validate(result).model_dump(mode="json")
            if "error" in result and result["error"] not in ERRORS:
                result = {"error": "invalid_request"}
            text = json.dumps(result, allow_nan=False, separators=(",", ":"))
            if len(text.encode()) > MAX_RESULT_BYTES:
                raise ValueError("result too large")
        except Exception:
            result = {"error": "invalid_request"}
            text = '{"error":"invalid_request"}'
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=text)],
            structuredContent=result,
            isError="error" in result,
        )

    return server


class BoundedInput:
    response_writer: MemoryObjectSendStream[SessionMessage]

    def __aiter__(self):
        return self

    async def __anext__(self):
        while True:
            raw = await self.read_message()
            if raw is not None:
                return raw

    async def read_message(self):
        raw = await anyio.to_thread.run_sync(sys.stdin.buffer.readline, MAX_FRAME_BYTES + 1)
        if not raw:
            raise StopAsyncIteration
        if len(raw) > MAX_FRAME_BYTES or not raw.endswith(b"\n"):
            raise ValueError("invalid_request")
        data = json.loads(raw, object_pairs_hook=_unique_object)
        types.JSONRPCMessage.model_validate(data)
        method = data.get("method")
        if "id" in data:
            identifier = data["id"]
            if not (
                type(identifier) is int and 0 <= identifier <= 2**53
                or type(identifier) is str
                and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", identifier)
            ):
                raise ValueError("invalid_request")
            if method == "server/discover":
                params = data.get("params", {})
                if (
                    set(data) - {"jsonrpc", "id", "method", "params"}
                    or type(params) is not dict
                    or set(params) - {"_meta"}
                    or ("_meta" in params and type(params["_meta"]) is not dict)
                ):
                    raise ValueError("invalid_request")
                await self.response_writer.send(
                    SessionMessage(types.JSONRPCMessage(types.JSONRPCError(
                        jsonrpc="2.0",
                        id=identifier,
                        error=types.ErrorData(code=-32601, message="Method not found"),
                    )))
                )
                return None
            if method not in {"initialize", "ping", "tools/list", "tools/call"}:
                raise ValueError("invalid_request")
            types.ClientRequest.model_validate(data)
        else:
            if method not in {"notifications/initialized", "notifications/cancelled"}:
                raise ValueError("invalid_request")
            types.ClientNotification.model_validate(data)
        return raw.decode("utf-8")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


async def serve(path: Path) -> None:
    server = create_server(path)
    bounded = BoundedInput()
    async with stdio_server(stdin=bounded) as (reader, writer):
        bounded.response_writer = writer
        await server.run(reader, writer, server.create_initialization_options())


def main() -> None:
    logging.disable(logging.CRITICAL)
    try:
        parser = argparse.ArgumentParser(exit_on_error=False)
        parser.add_argument("--store", required=True, type=Path)
        args = parser.parse_args()
        if not args.store.is_absolute():
            raise ValueError("store path must be absolute")
        anyio.run(serve, args.store)
    except Exception:
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
