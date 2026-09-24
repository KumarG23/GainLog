"""Synthetic-data tests only. Existing conftest pins an isolated /tmp database."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import inspect
from sqlmodel import Session


def today():
    return datetime.now(ZoneInfo("America/New_York")).date()


def snapshot(client):
    day = today().isoformat()
    response = client.get(f"/journey?startDate={day}&endDate={day}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def test_empty_journey_has_no_invented_preferences_or_checkins(client):
    data = snapshot(client)
    assert data["days"] == []
    assert data["preferences"]["wakeTime"] is None
    assert data["preferences"]["sleepMinutes"] is None
    assert data["preferences"]["focus"] is None


def test_journey_tables_are_additive_and_restart_idempotent(client):
    from backend.main import engine
    from backend.migrations.schema import apply_schema_migrations
    names = set(inspect(engine).get_table_names())
    assert {"journey_day", "journey_preferences", "nutrition_entry", "goal", "workout_session"} <= names
    assert apply_schema_migrations(engine) == []


def test_checkin_partial_update_preserves_other_fields(client):
    path = f"/journey/days/{today()}"
    first = client.patch(path, json={"expectedRevision": 0, "energy": 2, "note": "Synthetic test note", "trainingIntent": "rest"})
    assert first.status_code == 200
    assert first.json()["revision"] == 1
    assert first.json()["soreness"] is None
    second = client.patch(path, json={"expectedRevision": 1, "stress": 4, "reflection": "Synthetic reflection"})
    assert second.status_code == 200
    assert second.json()["energy"] == 2
    assert second.json()["note"] == "Synthetic test note"
    assert snapshot(client)["days"][0]["reflection"] == "Synthetic reflection"


def test_stale_write_conflicts_without_overwriting(client):
    path = f"/journey/days/{today()}"
    assert client.patch(path, json={"expectedRevision": 0, "energy": 3}).status_code == 200
    assert client.patch(path, json={"expectedRevision": 0, "energy": 5}).status_code == 409
    assert snapshot(client)["days"][0]["energy"] == 3


def test_clear_erases_note_but_keeps_revision_to_prevent_stale_recreation(client):
    path = f"/journey/days/{today()}"
    client.patch(path, json={"expectedRevision": 0, "note": "Synthetic private note", "reflection": "Synthetic private reflection"})
    cleared = client.delete(f"{path}?expectedRevision=1")
    assert cleared.status_code == 200
    assert cleared.json()["note"] is None
    assert cleared.json()["reflection"] is None
    assert cleared.json()["revision"] == 2
    assert client.patch(path, json={"expectedRevision": 0, "energy": 1}).status_code == 409
    from backend.journey import JourneyDayDB
    from backend.main import engine
    with Session(engine) as db:
        assert "Synthetic private" not in db.get(JourneyDayDB, str(today())).payload_json


@pytest.mark.parametrize("field,value", [("energy", 0), ("energy", 6), ("stress", "4"), ("soreness", True), ("soreness", 1.5), ("stressMinute", 1440), ("stressMinute", -1), ("trainingIntent", "push-harder"), ("note", "x" * 401), ("reflection", "x" * 401), ("nutritionReviewed", "yes"), ("nutritionFingerprint", "not-a-valid-token")])
def test_invalid_checkin_is_rejected_without_writes(client, field, value):
    response = client.patch(f"/journey/days/{today()}", json={"expectedRevision": 0, field: value})
    assert response.status_code == 422
    assert snapshot(client)["days"] == []


def test_future_and_invalid_timezone_rejected(client):
    assert client.patch(f"/journey/days/{today() + timedelta(days=2)}", json={"expectedRevision": 0, "energy": 1}).status_code == 422
    assert client.patch(f"/journey/days/{today()}?timeZone=Unknown/Zone", json={"expectedRevision": 0, "energy": 1}).status_code == 422


def test_bounded_journey_window(client):
    assert client.get(f"/journey?startDate={today()-timedelta(days=50)}&endDate={today()}").status_code == 422
    assert client.get(f"/journey?startDate={today()}&endDate={today()-timedelta(days=1)}").status_code == 422


def test_nutrition_review_is_explicit_with_server_timestamp(client):
    value = client.patch(f"/journey/days/{today()}", json={"expectedRevision": 0, "nutritionReviewed": True, "nutritionFingerprint": "0123456789abcdef"}).json()
    assert value["nutritionReviewed"] is True
    assert value["nutritionReviewedAt"] is not None
    assert value["nutritionFingerprint"] == "0123456789abcdef"


def test_preferences_save_validate_compare_and_clear(client):
    path = "/journey/preferences"
    assert client.patch(path, json={"expectedRevision": 0, "wakeTime": "25:00", "sleepMinutes": 480}).status_code == 422
    assert client.patch(path, json={"expectedRevision": 0, "wakeTime": "06:00"}).status_code == 422
    first = client.patch(path, json={"expectedRevision": 0, "wakeTime": "06:00", "sleepMinutes": 480, "focus": "sleep"})
    assert first.status_code == 200
    assert first.json()["revision"] == 1
    assert client.patch(path, json={"expectedRevision": 0, "focus": "strength"}).status_code == 409
    second = client.patch(path, json={"expectedRevision": 1, "focus": "movement"})
    assert second.json()["wakeTime"] == "06:00"
    assert client.patch(path, json={"expectedRevision": 2, "wakeTime": None, "sleepMinutes": None, "focus": None}).status_code == 200
    assert snapshot(client)["preferences"]["wakeTime"] is None


def test_writes_do_not_modify_existing_goals_food_or_workouts(client):
    paths = ["/goals/", "/nutrition/", "/workouts/", "/body-weight/"]
    before = [client.get(path).json() for path in paths]
    client.patch(f"/journey/days/{today()}", json={"expectedRevision": 0, "energy": 1, "trainingIntent": "rest"})
    client.patch("/journey/preferences", json={"expectedRevision": 0, "focus": "sleep"})
    assert [client.get(path).json() for path in paths] == before


def seed_sleep(*, overlap=False):
    from backend.main import engine
    from backend.health_v2_models import HealthImportRunDB, HealthSleepSessionDB, HealthSleepStageDB
    day = str(today())
    start, end = f"{day}T00:00:00Z", f"{day}T07:00:00Z"
    with Session(engine) as db:
        db.add(HealthImportRunDB(id="journey-test-run", requested_start=day, requested_end=day, started_at=start, status="complete"))
        db.commit()
        for sid, provenance in [("test-raw", "source_raw"), ("test-reconciled", "google_wearables_reconciled")]:
            db.add(HealthSleepSessionDB(id=sid, provenance=provenance, start_utc=start, end_utc=end, local_end_date=day, session_kind="MAIN_SLEEP", minutes_asleep=400, start_offset_seconds=0, end_offset_seconds=0, payload_hash="synthetic", import_run_id="journey-test-run", ingested_at=end))
        db.commit()
        for i, (a, b) in enumerate([("00:00", "01:00"), ("00:30" if overlap else "01:30", "02:00")]):
            db.add(HealthSleepStageDB(id=f"test-stage-{i}", session_id="test-reconciled", stage_type="DEEP" if i == 0 else "LIGHT", start_utc=f"{day}T{a}:00Z", end_utc=f"{day}T{b}:00Z", payload_hash="synthetic", import_run_id="journey-test-run", ingested_at=end))
        db.commit()


def test_sleep_detail_uses_one_preferred_session_and_preserves_gaps(client):
    seed_sleep()
    response = client.get(f"/journey/sleep/{today()}")
    assert response.status_code == 200
    data = response.json()
    assert data["night"]["provenance"] == "google_wearables_reconciled"
    assert data["timelineStatus"] == "available"
    assert len(data["stages"]) == 2
    assert "01:30" in data["stages"][1]["startUtc"]
    assert data["night"]["startOffsetSeconds"] == 0


def test_sleep_missing_is_not_generated_and_overlap_is_withheld(client):
    assert client.get(f"/journey/sleep/{today()}").json()["night"] is None
    seed_sleep(overlap=True)
    data = client.get(f"/journey/sleep/{today()}").json()
    assert data["timelineStatus"] == "invalid"
    assert data["stages"] == []
