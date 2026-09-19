from datetime import date
import json
import os

import pytest

from sqlmodel import Session, SQLModel, create_engine, select

from backend.health_v2_models import (
    HealthImportRunDB,
    HealthIntervalObservationDB,
    HealthMinuteSummaryDB,
    HealthSampleObservationDB,
    HealthSleepSessionDB,
)


def _engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'retention.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            HealthImportRunDB(
                id="run-1",
                requested_start="2026-01-01",
                requested_end="2026-09-19",
                started_at="2026-09-19T00:00:00Z",
                finished_at="2026-09-19T00:01:00Z",
                status="complete",
                complete=True,
            )
        )
        db.commit()
    return engine


def _sample(*, sample_id: str, data_type: str, local_date: str) -> HealthSampleObservationDB:
    return HealthSampleObservationDB(
        id=sample_id,
        provenance="raw",
        data_type=data_type,
        observed_at_utc=f"{local_date}T12:34:56Z",
        local_date=local_date,
        numeric_value=1.0,
        unit="unit",
        payload_hash=f"hash-{sample_id}",
        import_run_id="run-1",
        ingested_at="2026-09-19T00:00:00Z",
    )


def _interval(*, interval_id: str, data_type: str, local_date: str) -> HealthIntervalObservationDB:
    return HealthIntervalObservationDB(
        id=interval_id,
        provenance="raw",
        data_type=data_type,
        start_utc=f"{local_date}T12:00:00Z",
        end_utc=f"{local_date}T12:05:00Z",
        local_date=local_date,
        payload_hash=f"hash-{interval_id}",
        import_run_id="run-1",
        ingested_at="2026-09-19T00:00:00Z",
    )


def test_dry_run_reports_candidates_without_deleting(tmp_path):
    from backend.health_v2_retention import run_retention

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(_sample(sample_id="old-spo2", data_type="oxygen_saturation", local_date="2026-06-20"))
        db.add(_sample(sample_id="boundary-spo2", data_type="oxygen_saturation", local_date="2026-06-21"))
        db.commit()

    report = run_retention(engine, as_of=date(2026, 9, 19), today=date(2026, 9, 19), apply=False, batch_size=100)

    assert report["mode"] == "dry-run"
    assert report["cutoffs"]["90_days"] == "2026-06-21"
    assert report["candidates"]["sample"] == {"oxygen_saturation": 1}
    assert report["deleted"] == {"sample": {}, "interval": {}}
    with Session(engine) as db:
        assert len(db.exec(select(HealthSampleObservationDB)).all()) == 2


def test_old_heart_rate_requires_matching_minute_summary(tmp_path):
    from backend.health_v2_retention import run_retention

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(_sample(sample_id="covered", data_type="heart_rate", local_date="2026-06-20"))
        uncovered = _sample(sample_id="uncovered", data_type="heart_rate", local_date="2026-06-19")
        uncovered.observed_at_utc = "2026-06-19T12:34:56Z"
        db.add(uncovered)
        db.add(
            HealthMinuteSummaryDB(
                id="minute-covered",
                metric="heart_rate",
                minute_utc="2026-06-20T12:34:00Z",
                local_date="2026-06-20",
                provenance="raw",
                unit="bpm",
                sample_count=1,
                minimum=1,
                maximum=1,
                average=1,
                payload_hash="minute-hash",
                import_run_id="run-1",
                updated_at="2026-09-19T00:00:00Z",
            )
        )
        db.commit()

    report = run_retention(engine, as_of=date(2026, 9, 19), today=date(2026, 9, 19), apply=True, batch_size=1)

    assert report["candidates"]["sample"]["heart_rate"] == 1
    assert report["deleted"]["sample"]["heart_rate"] == 1
    with Session(engine) as db:
        ids = db.exec(select(HealthSampleObservationDB.id)).all()
        assert ids == ["uncovered"]


def test_type_policies_use_90_and_365_day_boundaries_and_retain_unknowns(tmp_path):
    from backend.health_v2_retention import run_retention

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(_sample(sample_id="old-hrv", data_type="heart_rate_variability_rmssd", local_date="2025-09-18"))
        db.add(_sample(sample_id="boundary-hrv", data_type="heart_rate_variability_rmssd", local_date="2025-09-19"))
        db.add(_sample(sample_id="unknown-sample", data_type="future_signal", local_date="2020-01-01"))
        db.add(_interval(interval_id="old-step", data_type="steps", local_date="2025-09-18"))
        db.add(_interval(interval_id="boundary-step", data_type="steps", local_date="2025-09-19"))
        db.add(_interval(interval_id="old-activity", data_type="activity_level", local_date="2026-06-20"))
        db.add(_interval(interval_id="boundary-activity", data_type="activity_level", local_date="2026-06-21"))
        db.add(_interval(interval_id="unknown-interval", data_type="future_interval", local_date="2020-01-01"))
        db.commit()

    report = run_retention(engine, as_of=date(2026, 9, 19), today=date(2026, 9, 19), apply=True, batch_size=1)

    assert report["cutoffs"]["365_days"] == "2025-09-19"
    assert report["candidates"]["sample"]["heart_rate_variability_rmssd"] == 1
    assert report["candidates"]["interval"] == {"activity_level": 1, "steps": 1}
    assert report["unknown_types"] == {
        "sample": {"future_signal": 1},
        "interval": {"future_interval": 1},
    }
    with Session(engine) as db:
        assert set(db.exec(select(HealthSampleObservationDB.id)).all()) == {
            "boundary-hrv",
            "unknown-sample",
        }
        assert set(db.exec(select(HealthIntervalObservationDB.id)).all()) == {
            "boundary-step",
            "boundary-activity",
            "unknown-interval",
        }


def test_request_validation_rejects_future_dates_and_unbounded_batches(tmp_path):
    from backend.health_v2_retention import run_retention

    engine = _engine(tmp_path)
    with pytest.raises(ValueError, match="future"):
        run_retention(
            engine,
            as_of=date(2026, 9, 20),
            today=date(2026, 9, 19),
        )
    for batch_size in (0, 10_001):
        with pytest.raises(ValueError, match="batch_size"):
            run_retention(
                engine,
                as_of=date(2026, 9, 19),
                today=date(2026, 9, 19),
                batch_size=batch_size,
            )


def test_receipt_contains_aggregate_storage_and_duration_only(tmp_path):
    from backend.health_v2_retention import run_retention

    report = run_retention(
        _engine(tmp_path),
        as_of=date(2026, 9, 19),
        today=date(2026, 9, 19),
    )

    assert report["database_bytes_before"] > 0
    assert report["database_bytes_after"] >= report["database_bytes_before"]
    assert report["duration_seconds"] >= 0
    assert "payload" not in str(report).lower()


def test_apply_never_deletes_protected_sleep_or_import_rows(tmp_path):
    from backend.health_v2_retention import run_retention

    engine = _engine(tmp_path)
    with Session(engine) as db:
        db.add(
            HealthSleepSessionDB(
                id="sleep-old",
                provenance="raw",
                start_utc="2020-01-01T00:00:00Z",
                end_utc="2020-01-01T08:00:00Z",
                session_kind="main",
                payload_hash="sleep-hash",
                import_run_id="run-1",
                ingested_at="2026-09-19T00:00:00Z",
            )
        )
        db.commit()

    run_retention(
        engine,
        as_of=date(2026, 9, 19),
        today=date(2026, 9, 19),
        apply=True,
    )

    with Session(engine) as db:
        assert db.get(HealthImportRunDB, "run-1") is not None
        assert db.get(HealthSleepSessionDB, "sleep-old") is not None


def test_cli_defaults_to_dry_run_and_emits_json(tmp_path, capsys):
    from backend.health_v2_retention import main

    result = main(
        ["--as-of", "2026-09-19", "--json"],
        engine_override=_engine(tmp_path),
        today=date(2026, 9, 19),
    )

    assert result == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["mode"] == "dry-run"
    assert receipt["deleted"] == {"sample": {}, "interval": {}}


@pytest.mark.skipif(
    not os.environ.get("GAINLOG_TEST_POSTGRES_URL"),
    reason="disposable PostgreSQL is not configured",
)
def test_postgresql_dry_run_and_batched_apply():
    from sqlalchemy import text
    from backend.health_v2_retention import run_retention

    engine = create_engine(os.environ["GAINLOG_TEST_POSTGRES_URL"])
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            HealthImportRunDB(
                id="pg-run",
                requested_start="2026-01-01",
                requested_end="2026-09-19",
                started_at="2026-09-19T00:00:00Z",
                status="complete",
                complete=True,
            )
        )
        row = _sample(sample_id="pg-spo2", data_type="oxygen_saturation", local_date="2026-06-20")
        row.import_run_id = "pg-run"
        db.add(row)
        db.commit()

    dry = run_retention(
        engine,
        as_of=date(2026, 9, 19),
        today=date(2026, 9, 19),
        batch_size=1,
    )
    applied = run_retention(
        engine,
        as_of=date(2026, 9, 19),
        today=date(2026, 9, 19),
        apply=True,
        batch_size=1,
    )

    assert dry["candidates"]["sample"] == {"oxygen_saturation": 1}
    assert applied["deleted"]["sample"] == {"oxygen_saturation": 1}
