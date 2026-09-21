from datetime import date, datetime, timedelta, timezone

from sqlmodel import Session, SQLModel, create_engine


def _stress_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'stress-model.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_missing_minute_is_unobserved_not_low_stress():
    from backend.health_v2_stress_model import score_stress_minute

    result = score_stress_minute(
        datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        None,
        baseline=None,
    )

    assert result == {
        "stress_score": None,
        "state": "unobserved",
        "confidence": 0.0,
        "context": "unknown",
        "components": {},
    }


def test_exercise_minute_is_context_not_stress():
    from backend.health_v2_stress_model import StressMinuteInput, score_stress_minute

    result = score_stress_minute(
        datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc),
        StressMinuteInput(heart_rate_bpm=170, sample_count=30, context="exercise"),
        baseline=None,
    )

    assert result == {
        "stress_score": None,
        "state": "exercise",
        "confidence": 1.0,
        "context": "exercise",
        "components": {"heart_rate": {"bpm": 170, "sample_count": 30}},
    }


def test_movement_minute_is_context_not_stress():
    from backend.health_v2_stress_model import StressMinuteInput, score_stress_minute

    result = score_stress_minute(
        datetime(2026, 9, 21, 14, 1, tzinfo=timezone.utc),
        StressMinuteInput(heart_rate_bpm=110, sample_count=18, context="activity"),
        baseline=None,
    )

    assert result["stress_score"] is None
    assert result["state"] == "activity"
    assert result["context"] == "activity"
    assert result["confidence"] == 0.9


def test_sleep_context_survives_without_heart_rate():
    from backend.health_v2_stress_model import StressMinuteInput, score_stress_minute

    result = score_stress_minute(
        datetime(2026, 9, 21, 6, 0, tzinfo=timezone.utc),
        StressMinuteInput(heart_rate_bpm=None, sample_count=0, context="sleep"),
        baseline=None,
    )

    assert result == {
        "stress_score": None,
        "state": "sleep",
        "confidence": 1.0,
        "context": "sleep",
        "components": {},
    }


def test_sedentary_minute_waits_for_personal_baseline():
    from backend.health_v2_stress_model import StressMinuteInput, score_stress_minute

    result = score_stress_minute(
        datetime(2026, 9, 21, 14, 2, tzinfo=timezone.utc),
        StressMinuteInput(heart_rate_bpm=72, sample_count=20, context="sedentary"),
        baseline=None,
    )

    assert result["stress_score"] is None
    assert result["state"] == "baseline_unavailable"
    assert result["context"] == "sedentary"
    assert result["confidence"] == 0.0


def test_sedentary_stress_is_personal_heart_rate_percentile():
    from backend.health_v2_stress_model import (
        StressMinuteInput,
        build_stress_baseline,
        score_stress_minute,
    )

    baseline = build_stress_baseline([
        ([60.0] * 34) + ([70.0] * 33) + ([80.0] * 33)
        for _ in range(7)
    ])
    result = score_stress_minute(
        datetime(2026, 9, 21, 14, 3, tzinfo=timezone.utc),
        StressMinuteInput(heart_rate_bpm=70, sample_count=20, context="sedentary"),
        baseline=baseline,
    )

    assert result["stress_score"] == 50
    assert result["state"] == "moderate"
    assert result["confidence"] == 1.0
    assert result["components"]["personal_baseline"] == {
        "median_bpm": 70.0,
        "days": 7,
        "minutes": 700,
        "percentile": 50,
        "elevation_bpm": 0.0,
    }


def test_baseline_requires_meaningful_sedentary_coverage_each_day():
    from backend.health_v2_stress_model import build_stress_baseline

    baseline = build_stress_baseline(([[65.0] * 50] * 6) + [[65.0]])

    assert baseline is None


def test_window_preserves_missing_sleep_exercise_activity_and_source_choice(tmp_path):
    from backend.health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthImportRunDB,
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSleepSessionDB,
    )
    from backend.health_v2_stress_model import evaluate_stress_window

    engine = _stress_engine(tmp_path)
    target = date(2026, 9, 20)
    with Session(engine) as db:
        db.add(HealthImportRunDB(
            id="run", requested_start="2026-09-01", requested_end="2026-09-21",
            started_at="2026-09-21T00:00:00Z", status="complete", complete=True,
        ))
        for day_offset in range(7, 0, -1):
            baseline_day = target - timedelta(days=day_offset)
            day_text = baseline_day.isoformat()
            for minute in range(50):
                minute_utc = datetime(
                    baseline_day.year, baseline_day.month, baseline_day.day,
                    14, minute, tzinfo=timezone.utc,
                )
                stamp = minute_utc.isoformat().replace("+00:00", "Z")
                db.add(HealthMinuteSummaryDB(
                    id=f"hr-{day_text}-{minute}", metric="heart_rate", minute_utc=stamp,
                    local_date=day_text, source_id="watch", provenance="source_raw",
                    unit="bpm", sample_count=20, minimum=60, maximum=79,
                    average=60 + (minute % 20), payload_hash=f"hr-{day_text}-{minute}",
                    import_run_id="run", updated_at="2026-09-21T00:00:00Z",
                ))
                db.add(HealthIntervalObservationDB(
                    id=f"activity-{day_text}-{minute}", provenance="source_raw",
                    data_type="activity_level", start_utc=stamp,
                    end_utc=(minute_utc + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
                    local_date=day_text, numeric_value=1, unit="minutes", category="SEDENTARY",
                    source_id="activity-watch", payload_hash=f"activity-{day_text}-{minute}",
                    import_run_id="run", ingested_at="2026-09-21T00:00:00Z",
                ))
            db.add(HealthDataQualityDB(
                id=f"quality-{day_text}", date=day_text, metric="heart_rate",
                status="present", coverage_ratio=0.9, payload_hash=f"quality-{day_text}",
                import_run_id="run", updated_at="2026-09-21T00:00:00Z",
            ))
        contexts = ("SEDENTARY", "MODERATELY_ACTIVE", "SEDENTARY", "SEDENTARY")
        for minute, category in enumerate(contexts):
            minute_utc = datetime(2026, 9, 20, 14, minute, tzinfo=timezone.utc)
            stamp = minute_utc.isoformat().replace("+00:00", "Z")
            db.add(HealthMinuteSummaryDB(
                id=f"target-hr-{minute}", metric="heart_rate", minute_utc=stamp,
                local_date=target.isoformat(), source_id="watch", provenance="source_raw",
                unit="bpm", sample_count=20, minimum=60, maximum=60,
                average=60, payload_hash=f"target-hr-{minute}", import_run_id="run",
                updated_at="2026-09-21T00:00:00Z",
            ))
            db.add(HealthIntervalObservationDB(
                id=f"target-activity-{minute}", provenance="source_raw",
                data_type="activity_level", start_utc=stamp,
                end_utc=(minute_utc + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
                local_date=target.isoformat(), numeric_value=1, unit="minutes", category=category,
                source_id="activity-watch", payload_hash=f"target-activity-{minute}",
                import_run_id="run", ingested_at="2026-09-21T00:00:00Z",
            ))
        db.add(HealthMinuteSummaryDB(
            id="inferior-source", metric="heart_rate", minute_utc="2026-09-20T14:00:00Z",
            local_date=target.isoformat(), source_id="air", provenance="source_raw",
            unit="bpm", sample_count=20, minimum=180, maximum=180, average=180,
            payload_hash="inferior-source", import_run_id="run",
            updated_at="2026-09-21T00:00:00Z",
        ))
        db.add(HealthExerciseSessionDB(
            id="exercise", provenance="google_wearables_reconciled",
            start_utc="2026-09-20T14:02:00Z", end_utc="2026-09-20T14:03:00Z",
            local_start_date=target.isoformat(), local_end_date=target.isoformat(),
            exercise_type="STRENGTH_TRAINING", active_duration_seconds=60,
            payload_hash="exercise", import_run_id="run", ingested_at="2026-09-21T00:00:00Z",
        ))
        db.add(HealthSleepSessionDB(
            id="sleep", provenance="google_wearables_reconciled",
            start_utc="2026-09-20T14:03:00Z", end_utc="2026-09-20T14:04:00Z",
            local_start_date=target.isoformat(), local_end_date=target.isoformat(),
            session_kind="MAIN_SLEEP", is_main_sleep=True, minutes_asleep=1,
            payload_hash="sleep", import_run_id="run", ingested_at="2026-09-21T00:00:00Z",
        ))
        db.add(HealthDataQualityDB(
            id="quality-target", date=target.isoformat(), metric="heart_rate",
            status="present", coverage_ratio=4 / 1440, payload_hash="quality-target",
            import_run_id="run", updated_at="2026-09-21T00:00:00Z",
        ))
        db.commit()

    result = evaluate_stress_window(engine, target, target + timedelta(days=1))
    day = result["days"][0]
    observed = {row["minute_utc"]: row for row in day["timeline"] if row["state"] != "unobserved"}

    assert observed["2026-09-20T14:00:00Z"]["state"] == "low"
    assert observed["2026-09-20T14:00:00Z"]["components"]["heart_rate"]["bpm"] == 60
    assert observed["2026-09-20T14:01:00Z"]["state"] == "activity"
    assert observed["2026-09-20T14:02:00Z"]["state"] == "exercise"
    assert observed["2026-09-20T14:03:00Z"]["state"] == "sleep"
    assert day["summary"]["expected_minutes"] == 1440
    assert day["summary"]["observed_heart_rate_minutes"] == 4
    assert day["summary"]["unobserved_minutes"] == 1436
    assert day["summary"]["scored_minutes"] == 1


def test_cli_receipt_is_aggregate_only(tmp_path, capsys):
    from backend.health_v2_stress_model import main

    engine = _stress_engine(tmp_path)
    exit_code = main(
        ["--start", "2026-09-20", "--end", "2026-09-21", "--json"],
        engine_override=engine,
    )
    payload = capsys.readouterr().out

    assert exit_code == 0
    assert '"model":"stress"' in payload
    assert '"total_days":1' in payload
    assert '"timeline"' not in payload
    assert '"components"' not in payload
