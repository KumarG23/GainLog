from datetime import date, timedelta

from sqlmodel import SQLModel, create_engine


def _validation_engine(tmp_path):
    from backend.main import WorkoutSessionDB  # noqa: F401

    engine = create_engine(f"sqlite:///{tmp_path / 'shadow-validation.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def _shadow_fixture():
    start = date(2026, 9, 1)
    dates = [(start + timedelta(days=offset)).isoformat() for offset in range(4)]
    sleep = {
        "days": [
            {"date": day, "score": score, "state": "moderate", "confidence": 1.0}
            for day, score in zip(dates, (50, 60, 70, 80))
        ]
    }
    recovery = {
        "days": [
            {"date": day, "score": score, "state": "moderate", "confidence": 1.0}
            for day, score in zip(dates, (55, 65, 75, 85))
        ]
    }
    load = {
        "days": [
            {
                "date": day,
                "load_points": points,
                "state": "rest" if points == 0 else "observed",
                "confidence": 1.0,
            }
            for day, points in zip(dates, (0, 100, 120, 80))
        ]
    }
    stress = {
        "days": [
            {
                "date": day,
                "summary": {
                    "expected_minutes": 1440,
                    "observed_heart_rate_minutes": 1300,
                    "scored_minutes": 100,
                    "state_counts": {
                        "low": 50,
                        "moderate": 50 - high,
                        "high": high,
                        "unobserved": 1340,
                    },
                    "baseline_days": 7,
                },
            }
            for day, high in zip(dates, (30, 20, 10, 5))
        ]
    }
    return dates, sleep, recovery, load, stress


def test_validation_reports_alignment_and_observational_correlations():
    from backend.health_v2_shadow_validation import validate_shadow_results

    dates, sleep, recovery, load, stress = _shadow_fixture()
    result = validate_shadow_results(
        sleep=sleep,
        recovery=recovery,
        load=load,
        stress=stress,
        workout_dates={dates[1], dates[2]},
    )

    assert result["structural"]["passed"] is True
    assert result["structural"]["violation_count"] == 0
    assert result["coverage"]["common_days"] == 4
    assert result["workout_alignment"] == {
        "logged_days": 2,
        "wearable_active_days": 3,
        "matched_days": 2,
        "logged_only_days": 0,
        "wearable_only_days": 1,
    }
    assert result["correlations"]["sleep_vs_recovery"] == {"n": 4, "spearman": 1.0}
    assert result["correlations"]["prior_load_vs_recovery"] == {"n": 3, "spearman": 1.0}
    assert result["correlations"]["prior_stress_high_fraction_vs_recovery"] == {
        "n": 3,
        "spearman": -1.0,
    }
    assert result["correlations"]["same_day_load_vs_stress_high_fraction"]["n"] == 4
    assert result["correlations"]["stress_high_fraction_vs_recovery"] == {
        "n": 4,
        "spearman": -1.0,
    }


def test_validation_rejects_missing_data_masquerading_as_low_score():
    from backend.health_v2_shadow_validation import validate_shadow_results

    dates, sleep, recovery, load, stress = _shadow_fixture()
    sleep["days"][0].update(score=10, state="unavailable")

    result = validate_shadow_results(
        sleep=sleep,
        recovery=recovery,
        load=load,
        stress=stress,
        workout_dates=set(),
    )

    assert result["structural"]["passed"] is False
    assert result["structural"]["violations"] == {
        "sleep_unavailable_with_score": 1,
    }


def test_cli_receipt_is_aggregate_only(tmp_path, capsys):
    from backend.health_v2_shadow_validation import main

    engine = _validation_engine(tmp_path)
    exit_code = main(
        ["--start", "2026-09-20", "--end", "2026-09-21", "--json"],
        engine_override=engine,
    )
    payload = capsys.readouterr().out

    assert exit_code == 0
    assert '"model":"shadow-validation"' in payload
    assert '"common_days":1' in payload
    assert '"days"' not in payload
    assert '"timeline"' not in payload
