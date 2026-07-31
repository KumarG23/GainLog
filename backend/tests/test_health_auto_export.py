import pytest


def _health_auto_export_payload():
    return {
        "data": {
            "metrics": [
                {
                    "name": "sleep_analysis",
                    "units": "hr",
                    "data": [
                        {
                            "date": "2026-07-31",
                            "totalSleep": 7.75,
                            "core": 4.6,
                            "deep": 1.2,
                            "rem": 1.95,
                            "inBed": 8.25,
                        }
                    ],
                },
                {
                    "name": "step_count",
                    "units": "count",
                    "data": [{"qty": 8123, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "active_energy",
                    "units": "kcal",
                    "data": [{"qty": 645.5, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "apple_exercise_time",
                    "units": "min",
                    "data": [{"qty": 52, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "apple_stand_hour",
                    "units": "count",
                    "data": [{"qty": 12, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "walking_running_distance",
                    "units": "km",
                    "data": [{"qty": 7.4, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "resting_heart_rate",
                    "units": "bpm",
                    "data": [{"qty": 58, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "heart_rate_variability",
                    "units": "ms",
                    "data": [{"qty": 47, "date": "2026-07-31 23:55:00 -0400"}],
                },
                {
                    "name": "weight_&_body_mass",
                    "units": "lb",
                    "data": [{"qty": 207.6, "date": "2026-07-31 07:04:00 -0400"}],
                },
                {
                    "name": "body_fat_percentage",
                    "units": "%",
                    "data": [{"qty": 0.246, "date": "2026-07-31 07:04:00 -0400"}],
                },
                {
                    "name": "lean_body_mass",
                    "units": "lb",
                    "data": [{"qty": 156.6, "date": "2026-07-31 07:04:00 -0400"}],
                },
                {
                    "name": "body_mass_index",
                    "units": "count",
                    "data": [{"qty": 29.0, "date": "2026-07-31 07:04:00 -0400"}],
                },
                {
                    "name": "dietary_caffeine",
                    "units": "mg",
                    "data": [{"qty": 180, "date": "2026-07-31 09:00:00 -0400"}],
                },
            ]
        }
    }


def test_health_auto_export_ingests_allowlisted_daily_and_body_metrics(client):
    response = client.post("/apple-health/auto-export", json=_health_auto_export_payload())

    assert response.status_code == 200
    assert response.json() == {
        "dailySummaries": 1,
        "bodyMeasurements": 1,
        "ignoredMetrics": ["dietary_caffeine"],
    }

    daily = client.get("/apple-health/daily?date=2026-07-31")
    assert daily.status_code == 200
    body = daily.json()
    assert body["sleepMinutes"] == 465
    assert body["deepSleepMinutes"] == 72
    assert body["coreSleepMinutes"] == 276
    assert body["remSleepMinutes"] == 117
    assert body["awakeMinutes"] is None
    assert body["steps"] == 8123
    assert body["activeCalories"] == 645.5
    assert body["exerciseMinutes"] == 52
    assert body["standHours"] == 12
    assert body["restingHeartRateBpm"] == 58
    assert body["hrvMs"] == 47
    assert body["walkingRunningMiles"] == 4.6

    weights = client.get("/body-weight/").json()
    assert len(weights) == 1
    assert weights[0]["weightLbs"] == 207.6
    assert weights[0]["bodyFatPercent"] == 24.6
    assert weights[0]["leanBodyMassLbs"] == 156.6
    assert weights[0]["bmi"] == 29.0
    assert weights[0]["source"] == "apple-health"
    assert weights[0]["sourceRecordId"] == "health-auto-export:2026-07-31"


def test_health_auto_export_retry_updates_without_duplicates(client):
    payload = _health_auto_export_payload()
    assert client.post("/apple-health/auto-export", json=payload).status_code == 200
    payload["data"]["metrics"][1]["data"][0]["qty"] = 9000
    assert client.post("/apple-health/auto-export", json=payload).status_code == 200

    assert client.get("/apple-health/daily?date=2026-07-31").json()["steps"] == 9000
    assert len(client.get("/body-weight/").json()) == 1


def test_health_auto_export_converts_official_metric_units_and_keeps_local_date(client):
    payload = {
        "data": {
            "metrics": [
                {
                    "name": "weight_&_body_mass",
                    "units": "kg",
                    "data": [
                        {"qty": 90, "date": "2026-07-31 00:05:00 -0400"}
                    ],
                },
                {
                    "name": "active_energy",
                    "units": "kJ",
                    "data": [
                        {"qty": 418.4, "date": "2026-07-31 23:55:00 -0400"}
                    ],
                },
                {
                    "name": "walking_running_distance",
                    "units": "m",
                    "data": [
                        {"qty": 1609.344, "date": "2026-07-31 23:55:00 -0400"}
                    ],
                },
            ]
        }
    }

    assert client.post("/apple-health/auto-export", json=payload).status_code == 200

    daily = client.get("/apple-health/daily?date=2026-07-31").json()
    assert daily["activeCalories"] == pytest.approx(100)
    assert daily["walkingRunningMiles"] == pytest.approx(1)
    weight = client.get("/body-weight/").json()[0]
    assert weight["weightLbs"] == pytest.approx(198.42, abs=0.01)
    assert weight["sourceRecordId"] == "health-auto-export:2026-07-31"


def test_health_auto_export_sleep_fallback_does_not_double_count_asleep_and_stages(client):
    payload = _health_auto_export_payload()
    sleep_sample = payload["data"]["metrics"][0]["data"][0]
    sleep_sample.pop("totalSleep")
    sleep_sample["asleep"] = 7.75

    assert client.post("/apple-health/auto-export", json=payload).status_code == 200

    daily = client.get("/apple-health/daily?date=2026-07-31").json()
    assert daily["sleepMinutes"] == 465


def test_health_auto_export_rejects_invalid_payload(client):
    assert client.post("/apple-health/auto-export", json={}).status_code == 422
    assert client.post(
        "/apple-health/auto-export",
        json={"data": {"metrics": "not-a-list"}},
    ).status_code == 422


def test_health_auto_export_ignores_malformed_optional_sleep_values(client):
    payload = {
        "data": {
            "metrics": [
                {
                    "name": "sleep_analysis",
                    "units": "hr",
                    "data": [
                        {
                            "date": "2026-07-31",
                            "totalSleep": "unknown",
                            "asleep": "unknown",
                        }
                    ],
                }
            ]
        }
    }

    response = client.post("/apple-health/auto-export", json=payload)

    assert response.status_code == 200
    assert response.json()["dailySummaries"] == 0


def test_health_auto_export_validates_every_record_before_writing(client):
    payload = _health_auto_export_payload()
    payload["data"]["metrics"][1]["data"][0]["qty"] = 300000

    response = client.post("/apple-health/auto-export", json=payload)

    assert response.status_code == 422
    assert client.get("/apple-health/daily?date=2026-07-31").status_code == 404
    assert client.get("/body-weight/").json() == []


def test_health_auto_export_rolls_back_all_records_when_a_later_write_fails(
    client, monkeypatch
):
    from backend import main

    def fail_body_upsert(*_args, **_kwargs):
        raise RuntimeError("forced body write failure")

    monkeypatch.setattr(main, "_upsert_sourced_body_weight", fail_body_upsert)

    with pytest.raises(RuntimeError, match="forced body write failure"):
        client.post("/apple-health/auto-export", json=_health_auto_export_payload())

    assert client.get("/apple-health/daily?date=2026-07-31").status_code == 404
    assert client.get("/body-weight/").json() == []
