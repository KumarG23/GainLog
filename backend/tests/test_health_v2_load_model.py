from datetime import date, timedelta

from sqlmodel import Session, SQLModel, create_engine


def _load_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'load-model.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_missing_load_inputs_are_unavailable_not_rest():
    from backend.health_v2_load_model import score_load_day

    result = score_load_day(date(2026, 9, 21), None)

    assert result == {
        "load_points": None,
        "state": "unavailable",
        "confidence": 0.0,
        "components": {},
    }


def test_observed_zero_exercise_is_a_rest_day():
    from backend.health_v2_load_model import LoadDayInput, score_load_day

    result = score_load_day(
        date(2026, 9, 21),
        LoadDayInput(exercise_minutes=0, heart_rate_coverage=0.9),
    )

    assert result == {
        "load_points": 0,
        "state": "rest",
        "confidence": 0.9,
        "quality_status": "present",
        "components": {
            "exercise_duration": {"minutes": 0, "base_points": 0}
        },
    }


def test_zone_intensity_adds_to_duration_without_penalizing_uncovered_minutes():
    from backend.health_v2_load_model import LoadDayInput, score_load_day

    result = score_load_day(
        date(2026, 9, 21),
        LoadDayInput(
            exercise_minutes=60,
            zone_minutes={"LIGHT": 10, "MODERATE": 20, "VIGOROUS": 15, "PEAK": 5},
        ),
    )

    assert result["load_points"] == 125
    assert result["state"] == "observed"
    assert result["confidence"] == 0.92
    assert result["components"] == {
        "exercise_duration": {"minutes": 60, "base_points": 60},
        "heart_rate_zones": {
            "minutes": {"LIGHT": 10, "MODERATE": 20, "VIGOROUS": 15, "PEAK": 5},
            "covered_minutes": 50,
            "coverage_ratio": 0.83,
            "intensity_bonus_points": 65,
        },
    }


def test_load_state_compares_with_prior_active_day_baseline():
    from backend.health_v2_load_model import LoadDayInput, score_load_day

    result = score_load_day(
        date(2026, 9, 21),
        LoadDayInput(exercise_minutes=130),
        baseline_points=[100] * 7,
    )

    assert result["load_points"] == 130
    assert result["state"] == "high"
    assert result["baseline"] == {
        "median_active_day_points": 100.0,
        "active_days": 7,
        "ratio": 1.3,
    }


def test_window_counts_only_zone_time_overlapping_reconciled_exercise(tmp_path):
    from backend.health_v2_load_model import evaluate_load_window
    from backend.health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthImportRunDB,
        HealthIntervalObservationDB,
    )

    engine = _load_engine(tmp_path)
    day = date(2026, 9, 20)
    with Session(engine) as db:
        db.add(HealthImportRunDB(
            id="run", requested_start=day.isoformat(),
            requested_end=(day + timedelta(days=2)).isoformat(),
            started_at="2026-09-22T00:00:00Z", status="complete", complete=True,
        ))
        db.add(HealthExerciseSessionDB(
            id="exercise", provenance="google_wearables_reconciled",
            start_utc="2026-09-20T14:00:00Z", end_utc="2026-09-20T15:00:00Z",
            local_start_date=day.isoformat(), local_end_date=day.isoformat(),
            exercise_type="STRENGTH_TRAINING", active_duration_seconds=3600,
            payload_hash="exercise", import_run_id="run", ingested_at="2026-09-22T00:00:00Z",
        ))
        for category, start_minute, end_minute in (
            ("MODERATE", 0, 20),
            ("VIGOROUS", 20, 30),
            ("PEAK", 30, 35),
            ("VIGOROUS", 90, 100),
        ):
            db.add(HealthIntervalObservationDB(
                id=f"zone-{category}-{start_minute}", provenance="source_raw",
                data_type="time_in_heart_rate_zone",
                start_utc=f"2026-09-20T{14 + start_minute // 60:02d}:{start_minute % 60:02d}:00Z",
                end_utc=f"2026-09-20T{14 + end_minute // 60:02d}:{end_minute % 60:02d}:00Z",
                local_date=day.isoformat(), numeric_value=end_minute - start_minute,
                unit="minutes", category=category, payload_hash=f"zone-{category}-{start_minute}",
                import_run_id="run", ingested_at="2026-09-22T00:00:00Z",
            ))
        for offset in (0, 1):
            quality_day = (day + timedelta(days=offset)).isoformat()
            db.add(HealthDataQualityDB(
                id=f"quality-{offset}", date=quality_day, metric="heart_rate",
                status="present", coverage_ratio=0.9, payload_hash=f"quality-{offset}",
                import_run_id="run", updated_at="2026-09-22T00:00:00Z",
            ))
        db.commit()

    result = evaluate_load_window(engine, day, day + timedelta(days=2))

    assert result["days"][0]["load_points"] == 115
    assert result["days"][0]["confidence"] == 0.79
    assert result["days"][0]["components"]["heart_rate_zones"]["covered_minutes"] == 35
    assert result["days"][1]["state"] == "rest"
    assert result["summary"] == {
        "total_days": 2,
        "available_days": 2,
        "unavailable_days": 0,
        "active_days": 1,
        "load_min": 0,
        "load_median": 57.5,
        "load_max": 115,
    }


def test_cli_receipt_is_aggregate_only(tmp_path, capsys):
    from backend.health_v2_load_model import main

    engine = _load_engine(tmp_path)
    exit_code = main(
        ["--start", "2026-09-20", "--end", "2026-09-21", "--json"],
        engine_override=engine,
    )
    payload = capsys.readouterr().out

    assert exit_code == 0
    assert '"model":"load"' in payload
    assert '"total_days":1' in payload
    assert '"days"' not in payload
    assert '"components"' not in payload


def test_trailing_baseline_excludes_active_days_older_than_twenty_eight_days():
    from backend.health_v2_load_model import _trailing_active_points

    target = date(2026, 9, 21)
    history = [
        (target - timedelta(days=29), 90),
        (target - timedelta(days=28), 100),
        (target - timedelta(days=1), 110),
    ]

    assert _trailing_active_points(history, target) == [100, 110]
