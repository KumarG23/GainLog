import os
from pathlib import Path

TEST_DB = Path("/tmp/gainlog-test.db")
os.environ["GAINLOG_DATABASE_URL"] = f"sqlite:///{TEST_DB}"

from fastapi.testclient import TestClient

from backend.main import app, engine


def reset_db():
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()


def test_workout_crud_round_trip():
    reset_db()
    with TestClient(app) as client:
        assert client.get("/workouts/").status_code == 200

        payload = {
            "date": "2026-06-15T12:00:00Z",
            "durationMinutes": 45,
            "avgHeartRate": 120,
            "activeCalories": 350,
            "notes": "test",
            "exercises": [
                {
                    "name": "Bench Press",
                    "sets": [
                        {"reps": 5, "weight": 135},
                        {"reps": 5, "weight": 145},
                    ],
                }
            ],
        }

        created = client.post("/workouts/", json=payload)
        assert created.status_code == 201
        body = created.json()
        assert body["durationMinutes"] == 45
        assert body["avgHeartRate"] == 120
        assert body["activeCalories"] == 350
        assert body["exercises"][0]["name"] == "Bench Press"

        session_id = body["id"]

        fetched = client.get(f"/workouts/{session_id}")
        assert fetched.status_code == 200
        assert fetched.json()["id"] == session_id

        listed = client.get("/workouts/")
        assert listed.status_code == 200
        assert any(item["id"] == session_id for item in listed.json())

        deleted = client.delete(f"/workouts/{session_id}")
        assert deleted.status_code == 204

        missing = client.get(f"/workouts/{session_id}")
        assert missing.status_code == 404


def test_cardio_exercise_round_trip():
    reset_db()
    with TestClient(app) as client:
        payload = {
            "date": "2026-07-21T12:00:00Z",
            "durationMinutes": 30,
            "avgHeartRate": 132,
            "activeCalories": 246,
            "exercises": [
                {
                    "name": "Elliptical",
                    "kind": "cardio",
                    "sets": [],
                    "cardioDurationMinutes": 30,
                    "distanceMiles": 2.4,
                    "resistanceLevel": 8,
                }
            ],
        }

        created = client.post("/workouts/", json=payload)

        assert created.status_code == 201
        exercise = created.json()["exercises"][0]
        assert exercise == {
            "id": exercise["id"],
            "name": "Elliptical",
            "kind": "cardio",
            "sets": [],
            "cardioDurationMinutes": 30,
            "distanceMiles": 2.4,
            "resistanceLevel": 8.0,
        }

        fetched = client.get(f"/workouts/{created.json()['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["exercises"][0]["kind"] == "cardio"
        assert fetched.json()["exercises"][0]["cardioDurationMinutes"] == 30


def test_mixed_workout_keeps_strength_and_cardio_session_metrics_separate():
    reset_db()
    with TestClient(app) as client:
        payload = {
            "date": "2026-07-22T18:00:00-04:00",
            "durationMinutes": 65,
            "avgHeartRate": 121,
            "activeCalories": 470,
            "strengthSummary": {
                "durationMinutes": 45,
                "avgHeartRate": 110,
                "activeCalories": 250,
            },
            "cardioSummary": {
                "durationMinutes": 20,
                "avgHeartRate": 145,
                "activeCalories": 220,
            },
            "exercises": [
                {
                    "name": "Bench Press",
                    "kind": "strength",
                    "sets": [{"reps": 10, "weight": 135}],
                },
                {
                    "name": "Elliptical",
                    "kind": "cardio",
                    "sets": [],
                    "cardioDurationMinutes": 20,
                    "distanceMiles": 1.8,
                },
            ],
        }

        created = client.post("/workouts/", json=payload)

        assert created.status_code == 201
        body = created.json()
        assert body["strengthSummary"] == {
            "durationMinutes": 45,
            "avgHeartRate": 110,
            "activeCalories": 250,
        }
        assert body["cardioSummary"] == {
            "durationMinutes": 20,
            "avgHeartRate": 145,
            "activeCalories": 220,
        }

        fetched = client.get(f"/workouts/{body['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["strengthSummary"] == body["strengthSummary"]
        assert fetched.json()["cardioSummary"] == body["cardioSummary"]
