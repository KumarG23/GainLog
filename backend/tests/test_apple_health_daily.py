def test_apple_health_daily_import_is_idempotent_and_preserves_omitted_values(client):
    payload = {
        "date": "2026-07-31",
        "sleepMinutes": 465,
        "deepSleepMinutes": 78,
        "coreSleepMinutes": 285,
        "remSleepMinutes": 102,
        "awakeMinutes": 34,
        "restingHeartRateBpm": 58,
        "hrvMs": 47.5,
        "steps": 8123,
        "activeCalories": 612.4,
        "exerciseMinutes": 46,
        "standHours": 12,
        "walkingRunningMiles": 4.1,
        "source": "apple-health",
    }

    created = client.post("/apple-health/daily/import", json=payload)

    assert created.status_code == 201
    assert created.json() == {**payload, "updatedAt": created.json()["updatedAt"]}

    corrected = client.post(
        "/apple-health/daily/import",
        json={
            "date": payload["date"],
            "steps": 9001,
            "activeCalories": 650,
            "source": "apple-health",
        },
    )

    assert corrected.status_code == 200
    assert corrected.json()["steps"] == 9001
    assert corrected.json()["activeCalories"] == 650
    assert corrected.json()["sleepMinutes"] == 465
    assert corrected.json()["hrvMs"] == 47.5

    fetched = client.get("/apple-health/daily?date=2026-07-31")
    assert fetched.status_code == 200
    assert fetched.json() == corrected.json()


def test_apple_health_daily_import_rejects_empty_or_impossible_payloads(client):
    empty = client.post(
        "/apple-health/daily/import",
        json={"date": "2026-07-31", "source": "apple-health"},
    )
    impossible = client.post(
        "/apple-health/daily/import",
        json={
            "date": "2026-07-31",
            "sleepMinutes": 1500,
            "restingHeartRateBpm": 400,
            "source": "apple-health",
        },
    )
    bad_date = client.post(
        "/apple-health/daily/import",
        json={"date": "July 31", "steps": 100, "source": "apple-health"},
    )

    assert empty.status_code == 422
    assert impossible.status_code == 422
    assert bad_date.status_code == 422


def test_dashboard_summary_includes_daily_health(client):
    client.post(
        "/apple-health/daily/import",
        json={
            "date": "2026-07-31",
            "sleepMinutes": 465,
            "steps": 8123,
            "restingHeartRateBpm": 58,
            "source": "apple-health",
        },
    )

    summary = client.get("/dashboard/summary?date=2026-07-31")

    assert summary.status_code == 200
    assert summary.json()["todayHealth"]["sleepMinutes"] == 465
    assert summary.json()["todayHealth"]["steps"] == 8123
    assert summary.json()["todayHealth"]["restingHeartRateBpm"] == 58


def test_dashboard_summary_has_null_daily_health_when_not_imported(client):
    summary = client.get("/dashboard/summary?date=2026-07-31")

    assert summary.status_code == 200
    assert summary.json()["todayHealth"] is None
