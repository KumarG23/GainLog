from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "gainlog.db"


def reset_db():
    if DB_PATH.exists():
        DB_PATH.unlink()


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
