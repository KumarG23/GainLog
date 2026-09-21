from datetime import date, timedelta

from sqlmodel import Session, SQLModel, create_engine


def _recovery_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'recovery-model.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_missing_recovery_inputs_are_unavailable():
    from backend.health_v2_recovery_model import score_recovery_day

    result = score_recovery_day(
        date(2026, 9, 21),
        None,
        baseline_hrv=[],
        baseline_rhr=[],
    )

    assert result == {
        "score": None,
        "state": "unavailable",
        "confidence": 0.0,
        "components": {},
    }


def test_sleep_only_recovery_does_not_penalize_missing_biomarkers():
    from backend.health_v2_recovery_model import RecoveryDayInput, score_recovery_day

    result = score_recovery_day(
        date(2026, 9, 21),
        RecoveryDayInput(sleep_score=82, sleep_confidence=1.0),
        baseline_hrv=[],
        baseline_rhr=[],
    )

    assert result["score"] == 82
    assert result["state"] == "high"
    assert result["confidence"] == 0.4
    assert result["components"] == {
        "sleep": {"score": 82, "source_confidence": 1.0, "weight": 0.4}
    }


def test_hrv_scores_against_trailing_personal_baseline():
    from backend.health_v2_recovery_model import RecoveryDayInput, score_recovery_day

    result = score_recovery_day(
        date(2026, 9, 21),
        RecoveryDayInput(sleep_score=80, sleep_confidence=1.0, hrv_rmssd=44.0),
        baseline_hrv=[40.0] * 14,
        baseline_rhr=[],
    )

    assert result["score"] == 85
    assert result["confidence"] == 0.75
    assert result["components"]["hrv"] == {
        "score": 90,
        "value_ms": 44.0,
        "baseline_median_ms": 40.0,
        "deviation_percent": 10.0,
        "baseline_days": 14,
        "weight": 0.35,
    }


def test_lower_resting_heart_rate_scores_above_personal_baseline():
    from backend.health_v2_recovery_model import RecoveryDayInput, score_recovery_day

    result = score_recovery_day(
        date(2026, 9, 21),
        RecoveryDayInput(
            sleep_score=80,
            sleep_confidence=1.0,
            hrv_rmssd=40.0,
            resting_heart_rate=57.0,
        ),
        baseline_hrv=[40.0] * 14,
        baseline_rhr=[60.0] * 14,
    )

    assert result["score"] == 79
    assert result["state"] == "moderate"
    assert result["confidence"] == 1.0
    assert result["components"]["resting_heart_rate"] == {
        "score": 90,
        "value_bpm": 57.0,
        "baseline_median_bpm": 60.0,
        "deviation_bpm": -3.0,
        "deviation_percent": -5.0,
        "baseline_days": 14,
        "weight": 0.25,
    }


def test_biomarkers_wait_for_fourteen_prior_days():
    from backend.health_v2_recovery_model import RecoveryDayInput, score_recovery_day

    result = score_recovery_day(
        date(2026, 9, 21),
        RecoveryDayInput(
            sleep_score=76,
            sleep_confidence=1.0,
            hrv_rmssd=20.0,
            resting_heart_rate=90.0,
        ),
        baseline_hrv=[40.0] * 13,
        baseline_rhr=[60.0] * 13,
    )

    assert result["score"] == 76
    assert result["confidence"] == 0.4
    assert set(result["components"]) == {"sleep"}


def test_partial_quality_caps_confidence_without_changing_score():
    from backend.health_v2_recovery_model import RecoveryDayInput, score_recovery_day

    complete = score_recovery_day(
        date(2026, 9, 20),
        RecoveryDayInput(
            sleep_score=80,
            sleep_confidence=1.0,
            hrv_rmssd=40.0,
            resting_heart_rate=60.0,
        ),
        baseline_hrv=[40.0] * 14,
        baseline_rhr=[60.0] * 14,
    )
    partial = score_recovery_day(
        date(2026, 9, 21),
        RecoveryDayInput(
            sleep_score=80,
            sleep_confidence=1.0,
            hrv_rmssd=40.0,
            resting_heart_rate=60.0,
            quality_status="partial",
        ),
        baseline_hrv=[40.0] * 14,
        baseline_rhr=[60.0] * 14,
    )

    assert partial["score"] == complete["score"]
    assert complete["confidence"] == 1.0
    assert partial["confidence"] == 0.5
    assert partial["quality_status"] == "partial"


def test_window_uses_only_prior_complete_biomarkers_for_baseline(tmp_path):
    from backend.health_v2_models import HealthDailyMetricDB, HealthDataQualityDB, HealthImportRunDB
    from backend.health_v2_recovery_model import evaluate_recovery_window

    engine = _recovery_engine(tmp_path)
    target = date(2026, 9, 21)
    with Session(engine) as db:
        db.add(HealthImportRunDB(
            id="run", requested_start="2026-09-01", requested_end="2026-09-22",
            started_at="2026-09-22T00:00:00Z", status="complete", complete=True,
        ))
        for offset in range(14, 0, -1):
            day = (target - timedelta(days=offset)).isoformat()
            for metric, value, unit in (
                ("daily_hrv_rmssd", 40.0, "ms"),
                ("resting_heart_rate", 60.0, "bpm"),
            ):
                db.add(HealthDailyMetricDB(
                    id=f"{metric}-{day}", date=day, metric=metric,
                    provenance="google_wearables_reconciled", numeric_value=value,
                    unit=unit, payload_hash=f"{metric}-{day}", import_run_id="run",
                    ingested_at="2026-09-22T00:00:00Z",
                ))
            for metric in ("hrv", "resting_heart_rate"):
                db.add(HealthDataQualityDB(
                    id=f"quality-{metric}-{day}", date=day, metric=metric,
                    status="present", payload_hash=f"quality-{metric}-{day}",
                    import_run_id="run", updated_at="2026-09-22T00:00:00Z",
                ))
        for metric, value, unit in (
            ("daily_hrv_rmssd", 44.0, "ms"),
            ("resting_heart_rate", 57.0, "bpm"),
        ):
            db.add(HealthDailyMetricDB(
                id=f"{metric}-target", date=target.isoformat(), metric=metric,
                provenance="google_wearables_reconciled", numeric_value=value,
                unit=unit, payload_hash=f"{metric}-target", import_run_id="run",
                ingested_at="2026-09-22T00:00:00Z",
            ))
        db.commit()

    result = evaluate_recovery_window(engine, target, target + timedelta(days=1))

    assert result["days"][0]["score"] == 90
    assert result["days"][0]["confidence"] == 0.6
    assert set(result["days"][0]["components"]) == {"hrv", "resting_heart_rate"}
    assert result["summary"] == {
        "total_days": 1,
        "available_days": 1,
        "unavailable_days": 0,
        "score_min": 90,
        "score_median": 90,
        "score_max": 90,
    }


def test_cli_receipt_is_aggregate_only(tmp_path, capsys):
    from backend.health_v2_recovery_model import main

    engine = _recovery_engine(tmp_path)
    exit_code = main(
        ["--start", "2026-09-20", "--end", "2026-09-21", "--json"],
        engine_override=engine,
    )
    payload = capsys.readouterr().out

    assert exit_code == 0
    assert '"model":"recovery"' in payload
    assert '"total_days":1' in payload
    assert '"days"' not in payload
    assert '"components"' not in payload
