def test_health_connect_daily_import_is_idempotent_and_maps_light_sleep_to_core(client):
    payload = {
        "date": "2026-08-21",
        "sleepMinutes": 445,
        "deepSleepMinutes": 80,
        "lightSleepMinutes": 250,
        "remSleepMinutes": 115,
        "awakeMinutes": 28,
        "restingHeartRateBpm": 54,
        "hrvMs": 42.5,
        "steps": 8100,
        "distanceMiles": 3.8,
        "activeCalories": 530.2,
        "totalCalories": 2140.7,
        "exerciseMinutes": 35,
        "source": "health-connect",
    }

    created = client.post("/health-connect/daily/import", json=payload)

    assert created.status_code == 201
    assert created.json() == {
        "date": "2026-08-21",
        "sleepMinutes": 445,
        "deepSleepMinutes": 80,
        "coreSleepMinutes": 250,
        "remSleepMinutes": 115,
        "awakeMinutes": 28,
        "restingHeartRateBpm": 54,
        "hrvMs": 42.5,
        "steps": 8100,
        "activeCalories": 530.2,
        "totalCalories": 2140.7,
        "exerciseMinutes": 35,
        "standHours": None,
        "walkingRunningMiles": 3.8,
        "source": "health-connect",
        "updatedAt": created.json()["updatedAt"],
    }

    corrected = client.post(
        "/health-connect/daily/import",
        json={
            "date": payload["date"],
            "steps": 9001,
            "source": "health-connect",
        },
    )

    assert corrected.status_code == 200
    assert corrected.json()["steps"] == 9001
    assert corrected.json()["coreSleepMinutes"] == 250
    assert corrected.json()["source"] == "health-connect"

    summary = client.get("/dashboard/summary?date=2026-08-21")
    assert summary.status_code == 200
    assert summary.json()["todayHealth"]["source"] == "health-connect"
    assert summary.json()["todayHealth"]["standHours"] is None


def test_health_connect_body_weight_import_uses_stable_source_record_id(client):
    payload = {
        "date": "2026-08-21T07:00:00-04:00",
        "weightLbs": 201.2,
        "bodyFatPercent": 22.4,
        "leanBodyMassLbs": 156.1,
        "bmi": 28.1,
        "source": "health-connect",
        "sourceRecordId": "health-connect:weight:record-123",
    }

    created = client.post("/body-weight/import", json=payload)
    corrected = client.post(
        "/body-weight/import",
        json={**payload, "weightLbs": 200.8},
    )

    assert created.status_code == 201
    assert corrected.status_code == 200
    assert corrected.json()["id"] == created.json()["id"]
    assert corrected.json()["weightLbs"] == 200.8
    assert len(client.get("/body-weight/").json()) == 1


def test_health_connect_reconciliation_replaces_removed_daily_metrics(client):
    created = client.post(
        "/health-connect/daily/import",
        json={
            "date": "2026-08-22",
            "sleepMinutes": 440,
            "steps": 8100,
            "activeCalories": 500,
            "source": "health-connect",
        },
    )
    assert created.status_code == 201

    replaced = client.post(
        "/health-connect/daily/import",
        json={
            "date": "2026-08-22",
            "steps": 8200,
            "replaceExisting": True,
            "source": "health-connect",
        },
    )

    assert replaced.status_code == 200
    assert replaced.json()["steps"] == 8200
    assert replaced.json()["sleepMinutes"] is None
    assert replaced.json()["activeCalories"] is None


def test_health_connect_reconciliation_can_clear_an_empty_day(client):
    created = client.post(
        "/health-connect/daily/import",
        json={
            "date": "2026-08-23",
            "steps": 5000,
            "source": "health-connect",
        },
    )
    assert created.status_code == 201

    cleared = client.post(
        "/health-connect/daily/import",
        json={
            "date": "2026-08-23",
            "replaceExisting": True,
            "source": "health-connect",
        },
    )

    assert cleared.status_code == 200
    assert cleared.json()["steps"] is None
    assert cleared.json()["sleepMinutes"] is None
