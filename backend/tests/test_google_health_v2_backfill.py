from datetime import date
import json

import pytest
from sqlmodel import Session, SQLModel, create_engine

from backend.health_v2_models import HealthImportRunDB


def _engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_plan_chunks_is_oldest_first_with_exclusive_end():
    from backend.google_health_v2_backfill import plan_chunks

    assert plan_chunks(date(2026, 6, 21), date(2026, 7, 7), chunk_days=7) == [
        (date(2026, 6, 21), date(2026, 6, 28)),
        (date(2026, 6, 28), date(2026, 7, 5)),
        (date(2026, 7, 5), date(2026, 7, 7)),
    ]


def test_completed_exact_chunks_skip_unless_replay(tmp_path):
    from backend.google_health_v2_backfill import run_backfill

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(
            HealthImportRunDB(
                id="complete-window",
                requested_start="2026-06-21",
                requested_end="2026-06-28",
                started_at="2026-07-01T00:00:00Z",
                finished_at="2026-07-01T00:01:00Z",
                status="complete",
                complete=True,
            )
        )
        db.commit()

    calls = []

    def sync(db, *, start_date, end_date):
        calls.append((start_date, end_date))
        return {
            "start_date": start_date,
            "end_date": end_date,
            "records_inserted": 2,
            "records_updated": 1,
            "records_unchanged": 3,
        }

    skipped = run_backfill(
        engine,
        start=date(2026, 6, 21),
        end=date(2026, 7, 5),
        chunk_days=7,
        sync_fn=sync,
        today=date(2026, 9, 19),
    )
    assert skipped["status"] == "complete"
    assert skipped["chunks"] == {
        "planned": 2, "completed": 1, "skipped": 1, "failed": 0, "deferred": 0
    }
    assert calls == [("2026-06-28", "2026-07-05")]

    calls.clear()
    replayed = run_backfill(
        engine,
        start=date(2026, 6, 21),
        end=date(2026, 6, 28),
        chunk_days=7,
        replay=True,
        sync_fn=sync,
        today=date(2026, 9, 19),
    )
    assert replayed["chunks"]["completed"] == 1
    assert calls == [("2026-06-21", "2026-06-28")]


def test_failure_stops_later_chunks_and_rerun_resumes(tmp_path):
    from backend.google_health_v2_backfill import run_backfill

    engine = _engine(tmp_path)
    calls = []

    def failing_sync(db, *, start_date, end_date):
        calls.append((start_date, end_date))
        raise RuntimeError("provider failed")

    failed = run_backfill(
        engine,
        start=date(2026, 6, 21),
        end=date(2026, 7, 12),
        chunk_days=7,
        sync_fn=failing_sync,
        today=date(2026, 9, 19),
    )
    assert failed["status"] == "failed"
    assert failed["chunks"] == {
        "planned": 3, "completed": 0, "skipped": 0, "failed": 1, "deferred": 2
    }
    assert calls == [("2026-06-21", "2026-06-28")]

    calls.clear()

    def successful_sync(db, *, start_date, end_date):
        calls.append((start_date, end_date))
        return {"records_inserted": 0, "records_updated": 0, "records_unchanged": 10}

    resumed = run_backfill(
        engine,
        start=date(2026, 6, 21),
        end=date(2026, 7, 12),
        chunk_days=7,
        max_chunks=1,
        sync_fn=successful_sync,
        today=date(2026, 9, 19),
    )
    assert resumed["status"] == "partial"
    assert resumed["chunks"] == {
        "planned": 3, "completed": 1, "skipped": 0, "failed": 0, "deferred": 2
    }
    assert resumed["records"]["unchanged"] == 10


def test_backfill_rejects_invalid_or_partial_windows(tmp_path):
    from backend.google_health_v2_backfill import run_backfill

    engine = _engine(tmp_path)
    noop = lambda *args, **kwargs: {}
    with pytest.raises(ValueError, match="366"):
        run_backfill(
            engine,
            start=date(2025, 1, 1),
            end=date(2026, 1, 3),
            sync_fn=noop,
            today=date(2026, 9, 19),
        )
    with pytest.raises(ValueError, match="partial"):
        run_backfill(
            engine,
            start=date(2026, 9, 1),
            end=date(2026, 9, 20),
            sync_fn=noop,
            today=date(2026, 9, 19),
        )


def test_max_chunks_limits_executions_not_completed_windows(tmp_path):
    from backend.google_health_v2_backfill import run_backfill

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(
            HealthImportRunDB(
                id="already-done",
                requested_start="2026-06-21",
                requested_end="2026-06-28",
                started_at="2026-07-01T00:00:00Z",
                status="complete",
                complete=True,
            )
        )
        db.commit()
    calls = []

    def sync(db, *, start_date, end_date):
        calls.append((start_date, end_date))
        return {}

    report = run_backfill(
        engine,
        start=date(2026, 6, 21),
        end=date(2026, 7, 12),
        chunk_days=7,
        max_chunks=1,
        sync_fn=sync,
        today=date(2026, 9, 19),
    )

    assert calls == [("2026-06-28", "2026-07-05")]
    assert report["chunks"] == {
        "planned": 3,
        "completed": 1,
        "skipped": 1,
        "failed": 0,
        "deferred": 1,
    }


def test_cli_emits_sanitized_json_receipt(tmp_path, capsys):
    from backend.google_health_v2_backfill import main

    calls = []

    def sync(db, *, start_date, end_date):
        calls.append((start_date, end_date))
        return {
            "records_inserted": 4,
            "records_updated": 0,
            "records_unchanged": 1,
            "records_seen": 5,
            "api_calls": 8,
            "pages_processed": 3,
            "peak_memory_kb": 1234,
            "duration_seconds": 2.5,
            "db_bytes_before": 1000,
            "db_bytes_after": 1400,
        }

    result = main(
        [
            "--start", "2026-06-21",
            "--end", "2026-06-28",
            "--chunk-days", "7",
            "--json",
        ],
        engine_override=_engine(tmp_path),
        sync_override=sync,
        today=date(2026, 9, 19),
    )

    assert result == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["records"] == {"inserted": 4, "updated": 0, "unchanged": 1}
    assert receipt["provider"] == {
        "records_seen": 5,
        "api_calls": 8,
        "pages_processed": 3,
        "peak_memory_kb": 1234,
        "duration_seconds": 2.5,
    }
    assert receipt["storage"] == {
        "database_bytes_before": 1000,
        "database_bytes_after": 1400,
        "growth_bytes": 400,
    }
    assert calls == [("2026-06-21", "2026-06-28")]
