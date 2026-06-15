def test_body_weight_crud_round_trip(client):
    payload = {
        "date": "2026-06-15T08:00:00Z",
        "weightLbs": 184.5,
        "notes": "Morning weigh-in",
    }

    created = client.post("/body-weight/", json=payload)
    assert created.status_code == 201
    body = created.json()
    assert body["weightLbs"] == 184.5
    assert body["notes"] == "Morning weigh-in"

    entry_id = body["id"]

    listed = client.get("/body-weight/")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == entry_id

    fetched = client.get(f"/body-weight/{entry_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == entry_id

    deleted = client.delete(f"/body-weight/{entry_id}")
    assert deleted.status_code == 204

    missing = client.get(f"/body-weight/{entry_id}")
    assert missing.status_code == 404
