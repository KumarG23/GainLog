from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest
from jsonschema import validate
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from conftest import CANARY
from test_queries import EXPECTED_TOOLS


def parameters(path: Path) -> StdioServerParameters:
    return StdioServerParameters(
        command="/usr/bin/env",
        args=[
            "-i", "PATH=/usr/bin:/bin", sys.executable, "-I", "-m",
            "gainlog_mcp.server", "--store", str(path),
        ],
    )


@pytest.mark.asyncio
async def test_official_sdk_lists_and_calls_every_tool(projection: Path, tmp_path: Path):
    errors = tmp_path / "stderr.txt"
    with errors.open("w+") as errlog:
        async with stdio_client(parameters(projection), errlog=errlog) as (reader, writer):
            async with ClientSession(reader, writer) as client:
                initialized = await client.initialize()
                assert initialized.serverInfo.name == "GainLog Read-only Health"
                tools = (await client.list_tools()).tools
                assert [tool.name for tool in tools] == EXPECTED_TOOLS
                for tool in tools:
                    assert tool.annotations.readOnlyHint is True
                    assert tool.annotations.destructiveHint is False
                    assert tool.annotations.idempotentHint is True
                    assert tool.annotations.openWorldHint is False
                    assert tool.inputSchema["additionalProperties"] is False
                    assert tool.outputSchema["additionalProperties"] is False
                    result = await client.call_tool(tool.name, {})
                    assert not result.isError, (tool.name, result)
                    validate(result.structuredContent, tool.outputSchema)
                    assert CANARY not in result.model_dump_json()

                denied = await client.call_tool(
                    "query_saved_reviews", {"url": f"https://{CANARY}.invalid"}
                )
                assert denied.isError
                assert denied.structuredContent == {"error": "invalid_request"}
                assert CANARY not in denied.model_dump_json()
    assert errors.read_text() == ""


def rpc(process: subprocess.Popen[str], message: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
    process.stdin.flush()
    return json.loads(process.stdout.readline())


def test_server_discover_falls_back_before_and_after_initialize(projection: Path):
    params = parameters(projection)
    process = subprocess.Popen(
        [params.command, *params.args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        for ident in ("openai-mcp-discover", "discover-after-init"):
            response = rpc(process, {
                "jsonrpc": "2.0", "id": ident, "method": "server/discover",
                "params": {"_meta": {"synthetic": True}},
            })
            assert response == {
                "jsonrpc": "2.0", "id": ident,
                "error": {"code": -32601, "message": "Method not found"},
            }
            if ident == "openai-mcp-discover":
                initialized = rpc(process, {
                    "jsonrpc": "2.0", "id": "initialize-1", "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "synthetic-test", "version": "1"},
                    },
                })
                assert initialized["id"] == "initialize-1"
                assert initialized["result"]["serverInfo"]["name"] == "GainLog Read-only Health"
                assert process.stdin is not None
                process.stdin.write(json.dumps({
                    "jsonrpc": "2.0", "method": "notifications/initialized",
                    "params": {},
                }) + "\n")
                process.stdin.flush()
    finally:
        process.stdin.close() if process.stdin else None
        process.wait(timeout=5)
    assert process.returncode == 0
    assert process.stderr is not None
    assert process.stderr.read() == ""


@pytest.mark.parametrize("payload", [
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":"CANARY"}}',
    '{"jsonrpc":"2.0","id":1,"method":"CANARY","params":{}}',
    'CANARY',
    'x' * 70000,
])
def test_malformed_protocol_fails_closed_without_echo(projection: Path, payload: str):
    params = parameters(projection)
    result = subprocess.run(
        [params.command, *params.args], input=payload + "\n", text=True,
        capture_output=True, timeout=5,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr == ""
