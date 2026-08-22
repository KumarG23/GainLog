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


def test_mixed_workout_keeps_strength_and_cardio_session_metrics_separate(monkeypatch):
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
            "totalCalories": None,
        }
        assert body["cardioSummary"] == {
            "durationMinutes": 20,
            "avgHeartRate": 145,
            "activeCalories": 220,
            "totalCalories": None,
        }

        fetched = client.get(f"/workouts/{body['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["strengthSummary"] == body["strengthSummary"]
        assert fetched.json()["cardioSummary"] == body["cardioSummary"]

        calls = {}

        class FakeProvider:
            def generate(self, prompt: str) -> str:
                calls["prompt"] = prompt
                return "One combined response covering strength and cardio."

        monkeypatch.setattr("backend.main.get_coach_provider", lambda: FakeProvider())
        insight = client.post(f"/workouts/{body['id']}/insight")

        assert insight.status_code == 200
        assert "Treat strength and cardio summaries as distinct segments" in calls["prompt"]
        assert "one combined response" in calls["prompt"]


def test_workout_total_calories_round_trip_and_coach_context(monkeypatch):
    reset_db()
    with TestClient(app) as client:
        payload = {
            "date": "2026-08-21T07:00:00-04:00",
            "durationMinutes": 65,
            "totalCalories": 610,
            "strengthSummary": {
                "durationMinutes": 45,
                "totalCalories": 380,
            },
            "cardioSummary": {
                "durationMinutes": 20,
                "totalCalories": 230,
            },
            "exercises": [
                {"name": "Chest Press", "sets": [{"reps": 10, "weight": 120}]},
                {
                    "name": "Elliptical",
                    "kind": "cardio",
                    "sets": [],
                    "cardioDurationMinutes": 20,
                },
            ],
        }

        created = client.post("/workouts/", json=payload)
        assert created.status_code == 201
        assert created.json()["totalCalories"] == 610
        assert created.json()["strengthSummary"]["totalCalories"] == 380
        assert created.json()["cardioSummary"]["totalCalories"] == 230

        calls = {}

        class FakeProvider:
            def generate(self, prompt: str) -> str:
                calls["prompt"] = prompt
                return "Total calories retained."

        monkeypatch.setattr("backend.main.get_coach_provider", lambda: FakeProvider())
        response = client.post(f"/workouts/{created.json()['id']}/insight")
        assert response.status_code == 200
        assert "Total calories 380 kcal" in calls["prompt"]
        assert "Total calories 230 kcal" in calls["prompt"]


def test_workout_insight_returns_and_persists_structured_coaching(monkeypatch):
    reset_db()
    with TestClient(app) as client:
        created = client.post(
            "/workouts/",
            json={
                "date": "2026-08-05T07:00:00-04:00",
                "durationMinutes": 31,
                "avgHeartRate": 120,
                "templateId": "recovery",
                "exercises": [
                    {
                        "name": "Treadmill Walk",
                        "kind": "cardio",
                        "sets": [],
                        "cardioDurationMinutes": 31,
                        "distanceMiles": 1.32,
                    }
                ],
            },
        )
        assert created.status_code == 201
        workout_id = created.json()["id"]
        calls = {}

        class FakeProvider:
            def generate(self, prompt: str) -> str:
                calls["prompt"] = prompt
                return """{
                    "headline": "Recovery cardio nailed",
                    "verdict": "You completed the planned easy session.",
                    "wins": ["31 minutes stayed inside the prescribed range."],
                    "caveat": "Heart-rate efficiency requires comparable speed and incline.",
                    "nextAction": {
                        "title": "Next move",
                        "detail": "Follow the next scheduled workout without adding extra work."
                    },
                    "question": "How did this feel?",
                    "confidence": "high"
                }"""

        monkeypatch.setattr("backend.main.get_coach_provider", lambda: FakeProvider())
        response = client.post(f"/workouts/{workout_id}/insight")

        assert response.status_code == 200
        assert response.json()["coachInsight"]["headline"] == "Recovery cardio nailed"
        assert response.json()["coachInsight"]["nextAction"]["title"] == "Next move"
        assert "WORKOUT PLAN: recovery" in calls["prompt"]
        assert "Never criticize absent strength during planned recovery cardio" in calls["prompt"]
        assert "Return only valid JSON" in calls["prompt"]

        persisted = client.get(f"/workouts/{workout_id}").json()
        assert persisted["templateId"] == "recovery"
        assert persisted["coachInsight"]["headline"] == "Recovery cardio nailed"


def test_workout_feedback_round_trip_and_history_context(monkeypatch):
    reset_db()
    with TestClient(app) as client:
        previous = client.post(
            "/workouts/",
            json={
                "date": "2026-08-04T07:00:00-04:00",
                "durationMinutes": 30,
                "exercises": [{"name": "Elliptical", "kind": "cardio", "sets": [], "cardioDurationMinutes": 30}],
            },
        ).json()
        feedback = client.patch(
            f"/workouts/{previous['id']}/feedback",
            json={"effort": "hard"},
        )
        assert feedback.status_code == 200
        assert feedback.json()["effort"] == "hard"
        pain_feedback = client.patch(
            f"/workouts/{previous['id']}/feedback",
            json={"pain": True},
        )
        assert pain_feedback.status_code == 200
        assert pain_feedback.json()["effort"] == "hard"
        assert pain_feedback.json()["pain"] is True

        current = client.post(
            "/workouts/",
            json={
                "date": "2026-08-05T07:00:00-04:00",
                "durationMinutes": 30,
                "exercises": [{"name": "Elliptical", "kind": "cardio", "sets": [], "cardioDurationMinutes": 30}],
            },
        ).json()
        calls = {}

        class FakeProvider:
            def generate(self, prompt: str) -> str:
                calls["prompt"] = prompt
                return """{"headline":"Steady work","verdict":"Session complete.","wins":[],"caveat":null,"nextAction":{"title":"Next move","detail":"Recover first."},"question":"How did this feel?","confidence":"medium"}"""

        monkeypatch.setattr("backend.main.get_coach_provider", lambda: FakeProvider())
        response = client.post(f"/workouts/{current['id']}/insight")

        assert response.status_code == 200
        assert "Reported effort: hard" in calls["prompt"]
        assert "Pain reported: yes" in calls["prompt"]


def test_malformed_structured_insight_uses_safe_card_and_preserves_legacy_text(monkeypatch):
    reset_db()
    with TestClient(app) as client:
        workout = client.post(
            "/workouts/",
            json={
                "date": "2026-08-05T07:00:00-04:00",
                "durationMinutes": 30,
                "exercises": [{"name": "Elliptical", "kind": "cardio", "sets": [], "cardioDurationMinutes": 30}],
            },
        ).json()

        class FakeProvider:
            def generate(self, prompt: str) -> str:
                return "Legacy coach prose that is not JSON."

        monkeypatch.setattr("backend.main.get_coach_provider", lambda: FakeProvider())
        response = client.post(f"/workouts/{workout['id']}/insight")

        assert response.status_code == 200
        assert response.json()["insight"] == "Legacy coach prose that is not JSON."
        assert response.json()["coachInsight"]["headline"] == "Workout complete"
        assert response.json()["coachInsight"]["verdict"] == "The coach response could not be structured. Your workout is still saved."
