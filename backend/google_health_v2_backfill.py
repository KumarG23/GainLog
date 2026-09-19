"""Resumable complete-day coordinator for bounded Google Health V2 backfills."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
import json
import sys
from time import monotonic
from typing import Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .health_v2_models import HealthImportRunDB
except ImportError:
    from health_v2_models import HealthImportRunDB


def plan_chunks(start: date, end: date, *, chunk_days: int) -> list[tuple[date, date]]:
    if chunk_days < 1 or chunk_days > 31:
        raise ValueError("chunk_days must be between 1 and 31")
    chunks = []
    cursor = start
    while cursor < end:
        next_end = min(cursor + timedelta(days=chunk_days), end)
        chunks.append((cursor, next_end))
        cursor = next_end
    return chunks


def _is_complete(db: Session, start: date, end: date) -> bool:
    count = db.exec(
        select(func.count(HealthImportRunDB.id)).where(
            HealthImportRunDB.requested_start == start.isoformat(),
            HealthImportRunDB.requested_end == end.isoformat(),
            HealthImportRunDB.status == "complete",
            HealthImportRunDB.complete == True,  # noqa: E712
        )
    ).one()
    return int(count) > 0


def run_backfill(
    engine: Engine,
    *,
    start: date,
    end: date,
    chunk_days: int = 7,
    replay: bool = False,
    max_chunks: int | None = None,
    sync_fn: Callable[..., dict[str, Any]],
    today: date,
) -> dict[str, Any]:
    if start >= end:
        raise ValueError("start must be before end")
    if (end - start).days > 366:
        raise ValueError("backfill window must not exceed 366 days")
    if end > today:
        raise ValueError("end must not include a future or partial day")
    planned = plan_chunks(start, end, chunk_days=chunk_days)
    if max_chunks is not None and max_chunks < 1:
        raise ValueError("max_chunks must be at least 1")
    started = monotonic()
    receipt = {
        "status": "complete",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "chunk_days": chunk_days,
        "replay": replay,
        "chunks": {
            "planned": len(planned),
            "completed": 0,
            "skipped": 0,
            "failed": 0,
            "deferred": 0,
        },
        "records": {"inserted": 0, "updated": 0, "unchanged": 0},
        "provider": {
            "records_seen": 0,
            "api_calls": 0,
            "pages_processed": 0,
            "peak_memory_kb": 0,
            "duration_seconds": 0.0,
        },
        "storage": {
            "database_bytes_before": None,
            "database_bytes_after": None,
            "growth_bytes": None,
        },
    }
    with Session(engine) as db:
        executions = 0
        for index, (chunk_start, chunk_end) in enumerate(planned):
            if not replay and _is_complete(db, chunk_start, chunk_end):
                receipt["chunks"]["skipped"] += 1
                continue
            if max_chunks is not None and executions >= max_chunks:
                receipt["chunks"]["deferred"] += 1
                continue
            executions += 1
            try:
                result = sync_fn(
                    db,
                    start_date=chunk_start.isoformat(),
                    end_date=chunk_end.isoformat(),
                )
            except Exception:
                receipt["status"] = "failed"
                receipt["chunks"]["failed"] += 1
                receipt["chunks"]["deferred"] += len(planned) - index - 1
                break
            receipt["chunks"]["completed"] += 1
            for source, target in (
                ("records_inserted", "inserted"),
                ("records_updated", "updated"),
                ("records_unchanged", "unchanged"),
            ):
                receipt["records"][target] += int(result.get(source, 0))
            for key in ("records_seen", "api_calls", "pages_processed"):
                receipt["provider"][key] += int(result.get(key, 0))
            receipt["provider"]["peak_memory_kb"] = max(
                receipt["provider"]["peak_memory_kb"],
                int(result.get("peak_memory_kb") or 0),
            )
            receipt["provider"]["duration_seconds"] += float(
                result.get("duration_seconds") or 0
            )
            if receipt["storage"]["database_bytes_before"] is None:
                receipt["storage"]["database_bytes_before"] = result.get("db_bytes_before")
            receipt["storage"]["database_bytes_after"] = result.get("db_bytes_after")
    if receipt["status"] == "complete" and receipt["chunks"]["deferred"]:
        receipt["status"] = "partial"
    before = receipt["storage"]["database_bytes_before"]
    after = receipt["storage"]["database_bytes_after"]
    if before is not None and after is not None:
        receipt["storage"]["growth_bytes"] = int(after) - int(before)
    receipt["provider"]["duration_seconds"] = round(
        receipt["provider"]["duration_seconds"], 3
    )
    receipt["duration_seconds"] = round(monotonic() - started, 6)
    return receipt


def main(
    argv: list[str] | None = None,
    *,
    engine_override: Engine | None = None,
    sync_override: Callable[..., dict[str, Any]] | None = None,
    today: date | None = None,
) -> int:
    parser = argparse.ArgumentParser(description="Run resumable Google Health V2 backfill chunks")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--chunk-days", type=int, default=7)
    parser.add_argument("--max-chunks", type=int)
    parser.add_argument("--replay", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    local_today = today or datetime.now(ZoneInfo("America/New_York")).date()
    try:
        start = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end)
        if engine_override is None or sync_override is None:
            try:
                from .google_health_v2 import sync_google_health_v2
                from .main import engine as application_engine
            except ImportError:
                from google_health_v2 import sync_google_health_v2
                from main import engine as application_engine
            engine_override = engine_override or application_engine
            sync_override = sync_override or sync_google_health_v2
        report = run_backfill(
            engine_override,
            start=start,
            end=end,
            chunk_days=args.chunk_days,
            replay=args.replay,
            max_chunks=args.max_chunks,
            sync_fn=sync_override,
            today=local_today,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":") if args.json else None))
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
