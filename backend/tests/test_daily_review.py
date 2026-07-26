from backend import main


def test_daily_review_combines_weight_nutrition_workout_and_goals(client, monkeypatch):
    client.post(
        "/body-weight/",
        json={"date": "2026-07-21T07:00:00Z", "weightLbs": 184.2},
    )
    client.post(
        "/goals/",
        json={
            "kind": "calories",
            "title": "Daily calories",
            "targetValue": 2200,
            "unit": "kcal",
            "startDate": "2026-07-01",
        },
    )
    client.post(
        "/goals/",
        json={
            "kind": "protein",
            "title": "Daily protein",
            "targetValue": 180,
            "unit": "g",
            "startDate": "2026-07-01",
        },
    )
    for entry in (
        {
            "date": "2026-07-21T08:00:00Z",
            "meal": "breakfast",
            "name": "Greek yogurt bowl",
            "calories": 400,
            "proteinG": 40,
            "carbsG": 35,
            "fatG": 10,
        },
        {
            "date": "2026-07-21T12:00:00Z",
            "meal": "lunch",
            "name": "Chicken bowl",
            "calories": 500,
            "proteinG": 50,
            "carbsG": 55,
            "fatG": 14,
        },
    ):
        client.post("/nutrition/", json=entry)
    client.post(
        "/workouts/",
        json={
            "date": "2026-07-21T18:00:00Z",
            "durationMinutes": 42,
            "strengthSummary": {
                "durationMinutes": 30,
                "avgHeartRate": 108,
                "activeCalories": 180,
            },
            "cardioSummary": {
                "durationMinutes": 12,
                "avgHeartRate": 142,
                "activeCalories": 130,
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
                    "cardioDurationMinutes": 12,
                    "distanceMiles": 1.1,
                    "resistanceLevel": 6,
                }
            ],
        },
    )

    calls = {}

    class FakeProvider:
        def generate(self, prompt: str) -> str:
            calls["prompt"] = prompt
            return "Balanced day. Finish logging dinner and keep tomorrow's cardio progressive."

    monkeypatch.setattr(main, "get_coach_provider", lambda: FakeProvider())

    response = client.post("/coach/daily-review?date=2026-07-21")

    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2026-07-21"
    assert body["review"].startswith("Balanced day.")
    assert body["generatedAt"]

    prompt = calls["prompt"]
    assert "184.2 lbs" in prompt
    assert "900 kcal" in prompt
    assert "90g protein" in prompt
    assert "Meals logged: breakfast, lunch" in prompt
    assert "Daily calories: 2200 kcal" in prompt
    assert "Daily protein: 180 g" in prompt
    assert "Elliptical" in prompt
    assert "12 min" in prompt
    assert "1.1 miles" in prompt
    assert "Strength session: 30 min, Avg HR 108 bpm, 180 kcal" in prompt
    assert "Cardio session: 12 min, Avg HR 142 bpm, 130 kcal" in prompt
    assert "Never label calories or macros as low, high, adequate, or inadequate without a matching numeric goal" in prompt
    assert "supportive but candid fitness coach texting a client" in prompt
    assert "Interpret the data rather than merely reciting it" in prompt
    assert "Recognize one specific win" in prompt
    assert "one realistic action for tomorrow with an example of how to execute it" in prompt
    assert "Be encouraging without empty praise or guilt" in prompt
    assert "Treat a numeric calorie goal as an upper daily budget" in prompt
    assert "Do not characterize an unlogged workout as missed or skipped" in prompt
    assert "5-7 natural sentences" in prompt

    persisted = client.get("/coach/daily-review?date=2026-07-21")
    assert persisted.status_code == 200
    assert persisted.json() == body
