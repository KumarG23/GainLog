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
