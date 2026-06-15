from datetime import date


def test_dashboard_summary_uses_real_logged_data(client):
    today = date.today().isoformat()

    weight = client.post(
        "/body-weight/",
        json={
            "date": f"{today}T07:30:00Z",
            "weightLbs": 184.2,
        },
    )
    assert weight.status_code == 201

    goal = client.post(
        "/goals/",
        json={
            "kind": "protein",
            "title": "Hit protein",
            "targetValue": 180,
            "unit": "g",
            "startDate": f"{today}T00:00:00Z",
        },
    )
    assert goal.status_code == 201

    nutrition = client.post(
        "/nutrition/",
        json={
            "date": f"{today}T12:00:00Z",
            "meal": "lunch",
            "name": "Turkey sandwich",
            "calories": 510,
            "proteinG": 38,
            "carbsG": 55,
            "fatG": 14,
        },
    )
    assert nutrition.status_code == 201

    workout = client.post(
        "/workouts/",
        json={
            "date": f"{today}T18:00:00Z",
            "durationMinutes": 45,
            "exercises": [
                {
                    "name": "Bench Press",
                    "sets": [
                        {"reps": 5, "weight": 135},
                        {"reps": 5, "weight": 145},
                    ],
                }
            ],
        },
    )
    assert workout.status_code == 201

    summary = client.get("/dashboard/summary")
    assert summary.status_code == 200
    body = summary.json()
    assert body["latestWeight"]["weightLbs"] == 184.2
    assert body["activeGoals"][0]["title"] == "Hit protein"
    assert body["todayNutrition"] == {
        "calories": 510,
        "proteinG": 38,
        "carbsG": 55,
        "fatG": 14,
    }
    assert body["workoutCount"] == 1
    assert body["totalWorkoutVolume"] == 1400
    assert body["latestWorkout"]["id"] == workout.json()["id"]
