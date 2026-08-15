def test_goal_create_list_patch_delete(client):
    payload = {
        "kind": "weight",
        "title": "Cut to 180",
        "targetValue": 180,
        "unit": "lbs",
        "startDate": "2026-06-15T00:00:00Z",
        "targetDate": "2026-09-01T00:00:00Z",
        "notes": "Slow and steady",
    }

    created = client.post("/goals/", json=payload)
    assert created.status_code == 201
    body = created.json()
    assert body["kind"] == "weight"
    assert body["targetValue"] == 180
    assert body["status"] == "active"

    goal_id = body["id"]

    listed = client.get("/goals/")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == goal_id

    patched = client.patch(
        f"/goals/{goal_id}",
        json={
            "title": "Cut to 178",
            "targetValue": 178,
            "status": "paused",
            "notes": "Adjusting timeline",
        },
    )
    assert patched.status_code == 200
    patched_body = patched.json()
    assert patched_body["title"] == "Cut to 178"
    assert patched_body["targetValue"] == 178
    assert patched_body["status"] == "paused"
    assert patched_body["notes"] == "Adjusting timeline"

    deleted = client.delete(f"/goals/{goal_id}")
    assert deleted.status_code == 204

    missing = client.patch(f"/goals/{goal_id}", json={"status": "active"})
    assert missing.status_code == 404


def test_goal_range_create_and_patch(client):
    created = client.post(
        "/goals/",
        json={
            "kind": "protein",
            "title": "Daily Protein",
            "targetValue": 170,
            "minimumValue": 160,
            "maximumValue": 180,
            "unit": "g",
            "startDate": "2026-08-15T00:00:00-04:00",
        },
    )

    assert created.status_code == 201
    assert created.json()["minimumValue"] == 160
    assert created.json()["targetValue"] == 170
    assert created.json()["maximumValue"] == 180

    goal_id = created.json()["id"]
    patched = client.patch(
        f"/goals/{goal_id}",
        json={"minimumValue": 155, "maximumValue": 175},
    )

    assert patched.status_code == 200
    assert patched.json()["minimumValue"] == 155
    assert patched.json()["maximumValue"] == 175


def test_goal_range_rejects_values_out_of_order(client):
    response = client.post(
        "/goals/",
        json={
            "kind": "protein",
            "title": "Broken range",
            "targetValue": 170,
            "minimumValue": 180,
            "maximumValue": 160,
            "unit": "g",
            "startDate": "2026-08-15T00:00:00-04:00",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Goal values must satisfy minimum <= target <= maximum"


def test_goal_range_rejects_non_finite_values(client):
    response = client.post(
        "/goals/",
        content=(
            '{"kind":"protein","title":"Broken number","minimumValue":NaN,'
            '"targetValue":170,"maximumValue":180,"unit":"g",'
            '"startDate":"2026-08-15T00:00:00-04:00"}'
        ),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Goal values must be finite numbers"


def test_goal_range_is_described_for_coaching():
    from backend.main import GoalDB, _format_goal_for_coach

    goal = GoalDB(
        id="protein-range",
        kind="protein",
        title="Daily Protein",
        minimum_value=160,
        target_value=170,
        maximum_value=180,
        unit="g",
        start_date="2026-08-15T00:00:00-04:00",
    )

    assert _format_goal_for_coach(goal) == "Daily Protein: 160–180 g (aim 170 g)"


def test_weight_goal_range_is_included_in_workout_coaching_context():
    from backend.main import GoalDB, NutritionTotals, _format_broader_context

    goal = GoalDB(
        id="weight-range",
        kind="weight",
        title="Weight management",
        minimum_value=170,
        target_value=175,
        maximum_value=180,
        unit="lbs",
        start_date="2026-08-15T00:00:00-04:00",
        target_date="2027-06-01",
    )

    context = _format_broader_context(
        latest_weight=None,
        active_weight_goal=goal,
        nutrition_totals=NutritionTotals(
            calories=0,
            protein_g=0,
            carbs_g=0,
            fat_g=0,
            fiber_g=0,
        ),
        nutrition_date="2026-08-15",
    )

    assert context == (
        "Active weight goal: Weight management: 170–180 lbs "
        "(aim 175 lbs) by 2027-06-01."
    )
