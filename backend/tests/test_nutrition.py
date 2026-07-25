def test_nutrition_create_list_filter_delete(client):
    breakfast = {
        "date": "2026-06-15T08:00:00Z",
        "meal": "breakfast",
        "name": "Greek yogurt bowl",
        "calories": 420,
        "proteinG": 35,
        "carbsG": 42,
        "fatG": 10,
        "fiberG": 8,
        "notes": "Blueberries and oats",
    }
    dinner = {
        "date": "2026-06-14T19:00:00Z",
        "meal": "dinner",
        "name": "Chicken rice bowl",
        "calories": 650,
        "proteinG": 52,
        "carbsG": 70,
        "fatG": 16,
    }

    created_breakfast = client.post("/nutrition/", json=breakfast)
    assert created_breakfast.status_code == 201
    breakfast_body = created_breakfast.json()
    assert breakfast_body["proteinG"] == 35
    assert breakfast_body["carbsG"] == 42
    assert breakfast_body["fatG"] == 10
    assert breakfast_body["fiberG"] == 8

    created_dinner = client.post("/nutrition/", json=dinner)
    assert created_dinner.status_code == 201
    assert created_dinner.json()["fiberG"] == 0

    listed = client.get("/nutrition/")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    filtered = client.get("/nutrition/?date=2026-06-15")
    assert filtered.status_code == 200
    filtered_body = filtered.json()
    assert len(filtered_body) == 1
    assert filtered_body[0]["name"] == "Greek yogurt bowl"

    fetched = client.get(f"/nutrition/{breakfast_body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == breakfast_body["id"]

    deleted = client.delete(f"/nutrition/{breakfast_body['id']}")
    assert deleted.status_code == 204

    missing = client.get(f"/nutrition/{breakfast_body['id']}")
    assert missing.status_code == 404
