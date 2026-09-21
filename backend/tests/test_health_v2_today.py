from datetime import date, datetime, timedelta, timezone


def test_today_builder_requests_sleep_baseline_before_target(monkeypatch):
    import backend.health_v2_today as today_module

    target = date(2026, 9, 21)
    captured = {}

    def fake_sleep(_engine, start, end):
        captured["sleep_start"] = start
        return {"days": [{
            "date": target.isoformat(),
            "score": 91,
            "state": "high",
            "confidence": 1.0,
            "components": {},
        }]}

    unavailable = {
        "date": target.isoformat(),
        "score": None,
        "state": "unavailable",
        "confidence": 0.0,
        "components": {},
    }
    monkeypatch.setattr(today_module, "evaluate_sleep_window", fake_sleep)
    monkeypatch.setattr(today_module, "evaluate_recovery_window", lambda *_: {"days": [dict(unavailable)]})
    monkeypatch.setattr(today_module, "evaluate_load_window", lambda *_: {"days": [{
        "date": target.isoformat(),
        "load_points": None,
        "state": "unavailable",
        "confidence": 0.0,
        "components": {},
    }]})
    monkeypatch.setattr(today_module, "evaluate_stress_window", lambda *_, **__: {"days": [{
        "date": target.isoformat(),
        "timeline": [{
            "stress_score": None,
            "state": "unobserved",
            "confidence": 0.0,
            "components": {},
        }] * 1440,
        "summary": {"baseline_days": 0},
    }]})

    payload = today_module.build_health_v2_today(
        object(),
        target,
        now=datetime(2026, 9, 22, tzinfo=timezone.utc),
    )

    assert captured["sleep_start"] == target - timedelta(days=28)
    assert payload["sleep"]["score"] == 91


def test_stress_timeline_aggregation_preserves_scored_and_context_states():
    from backend.health_v2_today import aggregate_stress_timeline

    timeline = []
    for minute in range(60):
        if minute < 30:
            timeline.append({
                "stress_score": 90 if minute < 15 else 30,
                "state": "high" if minute < 15 else "low",
                "confidence": 1.0,
                "context": "sedentary",
            })
        else:
            timeline.append({
                "stress_score": None,
                "state": "exercise",
                "confidence": 0.8,
                "context": "exercise",
            })

    segments = aggregate_stress_timeline(timeline, minutes_per_segment=30)

    assert segments == [
        {
            "start_minute": 0,
            "state": "moderate",
            "score": 60.0,
            "confidence": 1.0,
        },
        {
            "start_minute": 30,
            "state": "exercise",
            "score": None,
            "confidence": 0.8,
        },
    ]


def test_today_endpoint_keeps_missing_models_unavailable(client):
    response = client.get("/health-v2/today?date=2026-01-01")

    assert response.status_code == 200
    payload = response.json()
    assert payload["date"] == "2026-01-01"
    assert payload["version"] == "0.1-experimental"
    assert payload["sleep"]["state"] == "unavailable"
    assert payload["sleep"]["score"] is None
    assert payload["recovery"]["state"] == "unavailable"
    assert payload["recovery"]["score"] is None
    assert payload["load"]["state"] == "unavailable"
    assert payload["load"]["loadPoints"] is None
    assert payload["stress"]["state"] == "unavailable"
    assert payload["stress"]["score"] is None
    assert payload["stress"]["baselineReady"] is False
    assert len(payload["stress"]["segments"]) == 48
    assert {segment["state"] for segment in payload["stress"]["segments"]} == {"unobserved"}


def test_today_endpoint_rejects_invalid_date(client):
    response = client.get("/health-v2/today?date=not-a-date")

    assert response.status_code == 422
