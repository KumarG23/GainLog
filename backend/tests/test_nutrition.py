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


def test_nutrition_sync_feed_returns_only_changes_after_cursor(client):
    created = client.post(
        "/nutrition/",
        json={
            "date": "2026-08-26T08:00:00-04:00",
            "meal": "breakfast",
            "name": "Breakfast bowl",
            "calories": 432,
            "proteinG": 46,
            "carbsG": 41,
            "fatG": 15,
            "fiberG": 23.2,
        },
    )
    assert created.status_code == 201
    entry = created.json()

    first = client.get("/nutrition/sync?after=0&limit=100")
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["hasMore"] is False
    assert first_body["latestCursor"] == first_body["nextCursor"]
    assert first_body["events"] == [
        {
            "cursor": first_body["nextCursor"],
            "operation": "upsert",
            "entryId": entry["id"],
            "entry": entry,
        }
    ]

    unchanged = client.get(
        f"/nutrition/sync?after={first_body['nextCursor']}&limit=100"
    )
    assert unchanged.status_code == 200
    assert unchanged.json()["events"] == []
    assert unchanged.json()["nextCursor"] == first_body["nextCursor"]


def test_nutrition_sync_feed_carries_corrections_and_deletions(client):
    created = client.post(
        "/nutrition/",
        json={
            "date": "2026-08-26T12:00:00-04:00",
            "meal": "lunch",
            "name": "Lunch",
            "calories": 600,
        },
    ).json()
    initial_cursor = client.get("/nutrition/sync?after=0").json()["nextCursor"]

    corrected = client.patch(
        f"/nutrition/{created['id']}",
        json={"calories": 625, "proteinG": 50},
    )
    assert corrected.status_code == 200
    corrected_entry = corrected.json()
    correction_feed = client.get(
        f"/nutrition/sync?after={initial_cursor}"
    ).json()
    assert correction_feed["events"] == [
        {
            "cursor": correction_feed["nextCursor"],
            "operation": "upsert",
            "entryId": created["id"],
            "entry": corrected_entry,
        }
    ]

    corrected_cursor = correction_feed["nextCursor"]
    deleted = client.delete(f"/nutrition/{created['id']}")
    assert deleted.status_code == 204
    deletion_feed = client.get(
        f"/nutrition/sync?after={corrected_cursor}"
    ).json()
    assert deletion_feed["events"] == [
        {
            "cursor": deletion_feed["nextCursor"],
            "operation": "delete",
            "entryId": created["id"],
            "entry": None,
        }
    ]


def test_nutrition_sync_feed_paginates_without_skipping_events(client):
    for index in range(3):
        response = client.post(
            "/nutrition/",
            json={
                "date": f"2026-08-2{index + 1}T08:00:00-04:00",
                "meal": "breakfast",
                "name": f"Meal {index}",
                "calories": 400 + index,
            },
        )
        assert response.status_code == 201

    first = client.get("/nutrition/sync?after=0&limit=2").json()
    assert len(first["events"]) == 2
    assert first["hasMore"] is True
    assert first["nextCursor"] == first["events"][-1]["cursor"]
    assert first["latestCursor"] > first["nextCursor"]

    second = client.get(
        f"/nutrition/sync?after={first['nextCursor']}&limit=2"
    ).json()
    assert len(second["events"]) == 1
    assert second["hasMore"] is False
    assert second["nextCursor"] == second["latestCursor"]


def test_nutrition_sync_bootstrap_is_bounded_to_recent_data(client):
    old = client.post(
        "/nutrition/",
        json={
            "date": "2026-08-01T08:00:00-04:00",
            "meal": "breakfast",
            "name": "Old meal",
            "calories": 400,
        },
    )
    recent = client.post(
        "/nutrition/",
        json={
            "date": "2026-08-24T08:00:00-04:00",
            "meal": "breakfast",
            "name": "Recent meal",
            "calories": 432,
        },
    )
    assert old.status_code == 201
    assert recent.status_code == 201

    bootstrap = client.get(
        "/nutrition/sync/bootstrap?since=2026-08-20"
    )
    assert bootstrap.status_code == 200
    body = bootstrap.json()
    assert [entry["name"] for entry in body["entries"]] == ["Recent meal"]
    assert body["latestCursor"] == client.get(
        "/nutrition/sync?after=0&limit=1"
    ).json()["latestCursor"]


def test_nutrition_bootstrap_cursor_does_not_skip_a_concurrent_create(client):
    from sqlmodel import Session

    from backend.main import (
        NutritionEntryDB,
        _queue_nutrition_sync_event,
        app,
        engine,
        get_db,
    )

    first = client.post(
        "/nutrition/",
        json={
            "date": "2026-08-26T08:00:00-04:00",
            "meal": "breakfast",
            "name": "Before bootstrap",
            "calories": 400,
        },
    )
    assert first.status_code == 201
    cursor_before_race = client.get("/nutrition/sync?after=0").json()["latestCursor"]

    class InterleavingSession(Session):
        injected = False

        def inject_concurrent_create(self):
            if self.injected:
                return
            self.injected = True
            with Session(engine) as concurrent:
                raced = NutritionEntryDB(
                    id="bootstrap-race-meal",
                    date="2026-08-26T09:00:00-04:00",
                    meal="breakfast",
                    name="Created during bootstrap",
                    calories=401,
                )
                concurrent.add(raced)
                _queue_nutrition_sync_event(
                    concurrent,
                    "upsert",
                    raced.id,
                    raced,
                )
                concurrent.commit()

        def exec(self, statement, *args, **kwargs):
            result = super().exec(statement, *args, **kwargs)
            if self.injected:
                return result
            session = self

            class InterleavingResult:
                def all(self):
                    values = result.all()
                    session.inject_concurrent_create()
                    return values

                def one(self):
                    value = result.one()
                    session.inject_concurrent_create()
                    return value

            return InterleavingResult()

    def interleaving_db():
        with InterleavingSession(engine) as session:
            yield session

    app.dependency_overrides[get_db] = interleaving_db
    try:
        bootstrap = client.get(
            "/nutrition/sync/bootstrap?since=2026-08-20"
        )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert bootstrap.status_code == 200
    snapshot_cursor = bootstrap.json()["latestCursor"]
    assert snapshot_cursor == cursor_before_race
    catch_up = client.get(f"/nutrition/sync?after={snapshot_cursor}").json()
    assert [event["entryId"] for event in catch_up["events"]] == [
        "bootstrap-race-meal"
    ]
