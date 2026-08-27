from datetime import date, datetime, timedelta, timezone

from sqlmodel import Session

from backend import main


def _day(value: str, offset: int) -> str:
    return (date.fromisoformat(value) + timedelta(days=offset)).isoformat()


def test_health_daily_history_is_sorted_and_preserves_sources(client):
    with Session(main.engine) as db:
        db.add(main.AppleHealthDailyDB(
            date="2026-08-02",
            sleep_minutes=420,
            source="google-health",
            updated_at="2026-08-03T10:00:00+00:00",
        ))
        db.add(main.AppleHealthDailyDB(
            date="2026-08-01",
            hrv_ms=47,
            source="health-connect",
            updated_at="2026-08-02T10:00:00+00:00",
        ))
        db.commit()

    response = client.get("/health-data/daily")

    assert response.status_code == 200
    assert [row["date"] for row in response.json()] == ["2026-08-01", "2026-08-02"]
    assert [row["source"] for row in response.json()] == ["health-connect", "google-health"]
    assert response.json()[0]["sleepMinutes"] is None


def test_weekly_health_window_reports_metric_specific_completeness_and_sources():
    rows = [
        main.AppleHealthDailyDB(
            date=_day("2026-08-01", offset),
            hrv_ms=45 if offset == 0 else None,
            steps=8000,
            source="health-connect" if offset == 0 else "google-health",
            updated_at="2026-08-08T10:00:00+00:00",
        )
        for offset in range(7)
    ]

    formatted = main._format_health_window(rows, 7)

    assert "Observed health days: 7/7" in formatted
    assert "Average HRV: 45 ms (1/7 observed; sources: health-connect)" in formatted
    assert "Average sleep: unavailable (0/7 observed; sources: none)" in formatted
    assert "Average resting heart rate: unavailable (0/7 observed; sources: none)" in formatted
    assert "Average steps: 8,000 (7/7 observed; sources: google-health, health-connect)" in formatted


def test_weekly_weight_window_counts_distinct_days_and_uses_latest_same_day_value():
    rows = [
        main.BodyWeightEntryDB(
            date="2026-08-25T07:00:00-04:00",
            weight_lbs=205,
            source="manual",
        ),
        main.BodyWeightEntryDB(
            date="2026-08-25T10:00:00Z",
            weight_lbs=204.5,
            source="manual",
        ),
        main.BodyWeightEntryDB(
            date="2026-08-25T10:30:00Z",
            weight_lbs=204,
            source="manual",
        ),
    ]

    formatted = main._format_weight_window(rows, expected_days=7)

    assert "Weight observed days: 1/7 (3 measurements)" in formatted
    assert "Weight sources: manual" in formatted
    assert "Weight trend: one observed day at 205 lbs" in formatted
    assert "205 lbs to 204 lbs" not in formatted


def test_weekly_review_compares_completed_week_to_preceding_baseline_and_persists(client, monkeypatch):
    week_end = "2026-08-31"
    baseline_start = _day(week_end, -34)
    with Session(main.engine) as db:
        for offset in range(35):
            day = _day(baseline_start, offset)
            current = offset >= 28
            db.add(main.AppleHealthDailyDB(
                date=day,
                sleep_minutes=450 if current else 420,
                awake_minutes=45 if current else 60,
                resting_heart_rate_bpm=58 if current else 61,
                hrv_ms=52 if current else 46,
                steps=9000 if current else 7500,
                active_calories=600 if current else 500,
                exercise_minutes=45 if current else 35,
                source="google-health" if current else "health-connect",
                updated_at=datetime.now(timezone.utc).isoformat(),
            ))
        for offset in range(7):
            day = _day(week_end, offset - 6)
            db.add(main.NutritionEntryDB(
                date=f"{day}T12:00:00-04:00",
                meal="lunch",
                name="Prepared bowl",
                calories=2000,
                protein_g=170,
                carbs_g=190,
                fat_g=60,
                fiber_g=30,
            ))
        db.add(main.BodyWeightEntryDB(
            date="2026-08-01T07:00:00-04:00",
            weight_lbs=207,
            source="health-connect",
        ))
        db.add(main.BodyWeightEntryDB(
            date="2026-08-20T07:00:00-04:00",
            weight_lbs=206,
            source="health-connect",
        ))
        db.add(main.BodyWeightEntryDB(
            date="2026-08-25T07:00:00-04:00",
            weight_lbs=205,
            source="health-connect",
        ))
        db.add(main.BodyWeightEntryDB(
            date="2026-08-31T07:00:00-04:00",
            weight_lbs=203.5,
            source="health-connect",
        ))
        db.add(main.WorkoutSessionDB(
            date="2026-08-26T06:00:00-04:00",
            duration_minutes=50,
            template_id="push",
        ))
        db.add(main.WorkoutSessionDB(
            date="2026-08-29T06:00:00-04:00",
            duration_minutes=40,
            template_id="legs",
        ))
        db.commit()

    calls = {}

    class FakeProvider:
        def generate(self, prompt: str) -> str:
            calls["prompt"] = prompt
            return "Recovery improved across the week. Keep the same sleep window and training cadence."

    provider_config = {}

    def fake_get_coach_provider(**kwargs):
        provider_config.update(kwargs)
        return FakeProvider()

    monkeypatch.setattr(main, "get_coach_provider", fake_get_coach_provider)

    response = client.post(f"/coach/weekly-review?weekEnd={week_end}")

    assert response.status_code == 200
    body = response.json()
    assert body["weekStart"] == "2026-08-25"
    assert body["weekEnd"] == week_end
    assert body["review"].startswith("Recovery improved")
    assert body["generatedAt"]
    assert provider_config == {
        "model_env_var": "GAINLOG_WEEKLY_REVIEW_MODEL",
        "default_model": "gpt-5.6-sol",
    }

    prompt = calls["prompt"]
    assert "CURRENT 7-DAY WINDOW: 2026-08-25 through 2026-08-31" in prompt
    assert "PRECEDING 28-DAY BASELINE: 2026-07-28 through 2026-08-24" in prompt
    assert "Observed health days: 7/7" in prompt
    assert "Average sleep: 7h 30m" in prompt
    assert "Average resting heart rate: 58 bpm" in prompt
    assert "Average HRV: 52 ms" in prompt
    assert "Observed health days: 28/28" in prompt
    assert "Average sleep: 7h" in prompt
    assert "Average resting heart rate: 61 bpm" in prompt
    assert "Average HRV: 46 ms" in prompt
    assert "Nutrition logged: 7/7 days" in prompt
    assert "Average calories: 2000 kcal" in prompt
    assert "Average protein: 170g" in prompt
    assert "Workouts: 2 sessions, 90 min" in prompt
    assert "WEIGHT:\nWeight observed days: 2/7 (2 measurements)\nWeight sources: health-connect\nWeight trend: 205 lbs to 203.5 lbs (-1.5 lbs)" in prompt
    assert "BASELINE WEIGHT:\nWeight observed days: 2/28 (2 measurements)\nWeight sources: health-connect\nWeight trend: 207 lbs to 206 lbs (-1 lbs)" in prompt
    assert "Treat a current metric as sufficient only with at least 3/7 observed days" in prompt
    assert "Do not invent a readiness score" in prompt
    assert "Do not imply causation from correlation" in prompt
    assert "Base conclusions on multi-day patterns" in prompt
    assert "5-8 natural sentences" in prompt

    persisted = client.get(f"/coach/weekly-review?weekEnd={week_end}")
    assert persisted.status_code == 200
    assert persisted.json() == body


def test_weekly_review_rejects_invalid_week_end(client):
    response = client.post("/coach/weekly-review?weekEnd=08-31-2026")

    assert response.status_code == 422
