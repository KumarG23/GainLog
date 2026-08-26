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


def test_health_connect_body_weight_reconciliation_clears_removed_composition(client):
    payload = {
        "date": "2026-08-21T07:00:00-04:00",
        "weightLbs": 201.2,
        "bodyFatPercent": 22.4,
        "leanBodyMassLbs": 156.1,
        "bmi": 28.1,
        "source": "health-connect",
        "sourceRecordId": "health-connect:weight:replacement",
    }
    assert client.post("/body-weight/import", json=payload).status_code == 201

    replaced = client.post(
        "/body-weight/import",
        json={
            "date": payload["date"],
            "weightLbs": 200.8,
            "source": "health-connect",
            "sourceRecordId": payload["sourceRecordId"],
            "replaceExisting": True,
        },
    )

    assert replaced.status_code == 200
    assert replaced.json()["weightLbs"] == 200.8
    assert replaced.json()["bodyFatPercent"] is None
    assert replaced.json()["leanBodyMassLbs"] is None
    assert replaced.json()["bmi"] is None


def test_health_connect_body_weight_delete_is_scoped_and_idempotent(client):
    first = {
        "date": "2026-08-21T07:00:00-04:00",
        "weightLbs": 201.2,
        "source": "health-connect",
        "sourceRecordId": "health-connect:weight:delete-me",
    }
    second = {
        "date": "2026-08-22T07:00:00-04:00",
        "weightLbs": 200.8,
        "source": "health-connect",
        "sourceRecordId": "health-connect:weight:keep-me",
    }
    assert client.post("/body-weight/import", json=first).status_code == 201
    assert client.post("/body-weight/import", json=second).status_code == 201

    deleted = client.delete(
        "/health-connect/body-weight/health-connect%3Aweight%3Adelete-me",
    )
    replayed = client.delete(
        "/health-connect/body-weight/health-connect%3Aweight%3Adelete-me",
    )

    assert deleted.status_code == 204
    assert replayed.status_code == 204
    remaining = client.get("/body-weight/").json()
    assert [entry["sourceRecordId"] for entry in remaining] == [
        "health-connect:weight:keep-me",
    ]


def test_health_connect_body_weight_range_reconciliation_prunes_unknown_tombstones(client):
    for day, record_id in [
        ("2026-08-20", "outside"),
        ("2026-08-21", "stale"),
        ("2026-08-22", "keep"),
    ]:
        response = client.post(
            "/body-weight/import",
            json={
                "date": f"{day}T07:00:00-04:00",
                "weightLbs": 200,
                "source": "health-connect",
                "sourceRecordId": f"health-connect:weight:{record_id}",
            },
        )
        assert response.status_code == 201

    payload = {
        "startTime": "2026-08-21T00:00:00-04:00",
        "endTime": "2026-08-23T00:00:00-04:00",
        "sourceRecordIds": ["health-connect:weight:keep"],
    }
    first = client.post("/health-connect/body-weight/reconcile", json=payload)
    second = client.post("/health-connect/body-weight/reconcile", json=payload)

    assert first.status_code == 200
    assert first.json() == {"deleted": 1}
    assert second.status_code == 200
    assert second.json() == {"deleted": 0}
    assert {row["sourceRecordId"] for row in client.get("/body-weight/").json()} == {
        "health-connect:weight:outside",
        "health-connect:weight:keep",
    }


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


def test_health_connect_repair_state_tracks_every_imported_date(client):
    for day in ["2026-01-15", "2026-08-23"]:
        response = client.post(
            "/health-connect/daily/import",
            json={
                "date": day,
                "steps": 5000,
                "replaceExisting": True,
                "source": "health-connect",
            },
        )
        assert response.status_code == 201

    assert client.post(
        "/apple-health/daily/import",
        json={"date": "2025-12-01", "steps": 4000, "source": "apple-health"},
    ).status_code == 201
    assert client.post(
        "/body-weight/import",
        json={
            "date": "2026-02-20T07:00:00-05:00",
            "weightLbs": 200,
            "source": "health-connect",
            "sourceRecordId": "health-connect:weight:repair-state",
        },
    ).status_code == 201

    response = client.get("/health-connect/repair-state")

    assert response.status_code == 200
    assert response.json() == {
        "dailyDates": ["2026-01-15", "2026-08-23"],
        "bodyWeightInstants": ["2026-02-20T07:00:00-05:00"],
    }


def test_startup_backfills_legacy_health_connect_daily_ownership():
    from fastapi.testclient import TestClient
    from sqlmodel import Session, SQLModel

    from backend.main import AppleHealthDailyDB, app, engine
    from backend.tests.conftest import TEST_DB

    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(AppleHealthDailyDB(
            date="2026-03-04",
            steps=6100,
            source="health-connect",
            updated_at="2026-03-04T12:00:00+00:00",
        ))
        db.commit()

    with TestClient(app) as legacy_client:
        response = legacy_client.get("/health-connect/repair-state")

    assert response.status_code == 200
    assert response.json()["dailyDates"] == ["2026-03-04"]
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
