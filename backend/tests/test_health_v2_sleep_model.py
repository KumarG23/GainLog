from datetime import date

from sqlmodel import Session, SQLModel, create_engine


def _sleep_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'sleep-model.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_missing_sleep_is_unavailable_not_bad_recovery():
    from backend.health_v2_sleep_model import score_sleep_day

    result = score_sleep_day(date(2026, 9, 20), None, baseline_midpoints=[])

    assert result["score"] is None
    assert result["state"] == "unavailable"
    assert result["confidence"] == 0.0
    assert result["components"] == {}


def test_duration_only_score_does_not_penalize_missing_optional_inputs():
    from backend.health_v2_sleep_model import SleepDayInput, score_sleep_day

    result = score_sleep_day(
        date(2026, 9, 20),
        SleepDayInput(total_sleep_minutes=480),
        baseline_midpoints=[],
    )

    assert result["score"] == 100
    assert result["state"] == "high"
    assert result["confidence"] == 0.6
    assert result["components"] == {
        "duration": {"score": 100, "value_minutes": 480, "weight": 0.6}
    }


def test_efficiency_contributes_when_sleep_period_is_available():
    from backend.health_v2_sleep_model import SleepDayInput, score_sleep_day

    result = score_sleep_day(
        date(2026, 9, 20),
        SleepDayInput(total_sleep_minutes=480, minutes_in_sleep_period=540),
        baseline_midpoints=[],
    )

    assert result["score"] == 97
    assert result["confidence"] == 0.85
    assert result["components"]["efficiency"] == {
        "score": 91,
        "value_percent": 88.9,
        "weight": 0.25,
    }


def test_consistency_uses_trailing_baseline_with_midnight_wraparound():
    from backend.health_v2_sleep_model import SleepDayInput, score_sleep_day

    result = score_sleep_day(
        date(2026, 9, 20),
        SleepDayInput(
            total_sleep_minutes=480,
            minutes_in_sleep_period=540,
            midpoint_minute=10,
        ),
        baseline_midpoints=[1435, 0, 5, 10, 15, 20, 25],
    )

    assert result["score"] == 98
    assert result["confidence"] == 1.0
    assert result["components"]["consistency"] == {
        "score": 100,
        "deviation_minutes": 10,
        "baseline_days": 7,
        "weight": 0.15,
    }


def test_partial_quality_caps_confidence_without_inventing_a_penalty():
    from backend.health_v2_sleep_model import SleepDayInput, score_sleep_day

    result = score_sleep_day(
        date(2026, 9, 21),
        SleepDayInput(total_sleep_minutes=480, quality_status="partial"),
        baseline_midpoints=[],
    )

    assert result["score"] == 100
    assert result["confidence"] == 0.5
    assert result["quality_status"] == "partial"


def test_window_prefers_reconciled_main_sleep_over_raw_duplicate(tmp_path):
    from backend.health_v2_models import HealthDataQualityDB, HealthImportRunDB, HealthSleepSessionDB
    from backend.health_v2_sleep_model import evaluate_sleep_window

    engine = _sleep_engine(tmp_path)
    with Session(engine) as db:
        db.add(HealthImportRunDB(
            id="run", requested_start="2026-09-19", requested_end="2026-09-21",
            started_at="2026-09-21T00:00:00Z", status="complete", complete=True,
        ))
        for row_id, provenance, minutes in (
            ("raw", "source_raw", 300),
            ("preferred", "google_wearables_reconciled", 480),
        ):
            db.add(HealthSleepSessionDB(
                id=row_id, provenance=provenance, start_utc="2026-09-20T03:00:00Z",
                end_utc="2026-09-20T11:30:00Z", local_end_date="2026-09-20",
                session_kind="MAIN_SLEEP", is_main_sleep=True, minutes_asleep=minutes,
                minutes_in_sleep_period=600, payload_hash=row_id, import_run_id="run",
                ingested_at="2026-09-21T00:00:00Z",
            ))
        db.add(HealthDataQualityDB(
            id="quality", date="2026-09-20", metric="sleep", status="present",
            payload_hash="quality", import_run_id="run", updated_at="2026-09-21T00:00:00Z",
        ))
        db.commit()

    result = evaluate_sleep_window(engine, date(2026, 9, 20), date(2026, 9, 21))

    assert result["days"][0]["score"] == 87
    assert result["days"][0]["source_provenance"] == "google_wearables_reconciled"
    assert result["summary"]["available_days"] == 1


def test_cli_receipt_is_aggregate_only(tmp_path, capsys):
    from backend.health_v2_sleep_model import main

    engine = _sleep_engine(tmp_path)
    exit_code = main(
        ["--start", "2026-09-20", "--end", "2026-09-21", "--json"],
        engine_override=engine,
    )
    payload = capsys.readouterr().out

    assert exit_code == 0
    assert '"model":"sleep"' in payload
    assert '"total_days":1' in payload
    assert '"days"' not in payload
    assert '"components"' not in payload
