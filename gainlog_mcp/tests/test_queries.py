from __future__ import annotations

from pathlib import Path

import pytest


EXPECTED_TOOLS = [
    "get_data_coverage",
    "list_workouts",
    "get_workout",
    "query_nutrition",
    "query_body_composition",
    "query_daily_health",
    "query_goals",
    "query_saved_reviews",
]


def test_every_query_is_useful_and_preserves_zero_null(projection: Path):
    from gainlog_mcp.queries import query

    coverage = query(projection, "get_data_coverage", {})
    assert coverage["exported_at"] == "2026-09-08T16:00:00Z"
    assert coverage["domains"]["daily_health"]["records"] == 1
    assert coverage["source_connections"][0]["connected"] is True
    assert coverage["omissions"]["credentials"] == "not_exported"

    workouts = query(projection, "list_workouts", {})
    assert workouts["items"][0]["id"] == "workout-1"
    detail = query(projection, "get_workout", {"session_id": "workout-1"})
    assert detail["workout"]["exercises"][0]["sets"][0]["reps"] == 0
    assert detail["workout"]["exercises"][0]["sets"][0]["weight"] == 0.0

    nutrition = query(projection, "query_nutrition", {"entry_id": "food-1"})
    assert nutrition["items"][0]["fiber_g"] == 10.0
    body = query(projection, "query_body_composition", {"entry_id": "weight-1"})
    assert body["items"][0]["body_fat_percent"] is None
    assert body["items"][0]["lean_body_mass_lbs"] == 150.0

    health = query(projection, "query_daily_health", {"date": "2026-09-02"})
    item = health["items"][0]
    assert item["steps"] == 0
    assert item["sleep_minutes"] is None
    assert item["deep_sleep_minutes"] == 0
    snapshots = query(
        projection,
        "query_daily_health",
        {"date": "2026-09-02", "dataset": "google_snapshot"},
    )
    assert snapshots["items"][0]["steps"] == 1000
    assert snapshots["items"][0]["source"] == "google-health-snapshot"

    goals = query(projection, "query_goals", {"goal_id": "goal-1"})
    assert goals["items"][0]["minimum_value"] == 160.0
    for kind in ("daily", "weekly", "trend"):
        reviews = query(projection, "query_saved_reviews", {"kind": kind})
        assert reviews["items"]


def test_pagination_ranges_and_precise_missing_records(projection: Path):
    from gainlog_mcp.queries import query

    assert query(projection, "list_workouts", {"limit": 1})["next_offset"] is None
    assert query(projection, "get_workout", {"session_id": "missing"}) == {
        "error": "not_found"
    }
    assert query(projection, "query_nutrition", {"entry_id": "missing"}) == {
        "error": "not_found"
    }
    assert query(
        projection,
        "query_daily_health",
        {"start_date": "2025-01-01", "end_date": "2026-09-02"},
    ) == {"error": "invalid_request"}


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("unknown", {}),
        ("get_data_coverage", {"token": "CANARY"}),
        ("list_workouts", {"limit": True}),
        ("list_workouts", {"limit": 51}),
        ("query_nutrition", {"start_date": "2026-09-01"}),
        ("query_body_composition", {"entry_id": "x" * 129}),
        ("query_daily_health", {"date": "2026-9-2"}),
        ("query_goals", {"status": "active'; DROP TABLE goal;--"}),
        ("query_saved_reviews", {"kind": "regenerate"}),
        ("query_saved_reviews", {"path": "/etc/gainlog.env"}),
    ],
)
def test_forbidden_or_unbounded_queries_fail_closed_without_echo(
    projection: Path, tool: str, arguments: dict,
):
    from gainlog_mcp.queries import query

    assert query(projection, tool, arguments) == {"error": "invalid_request"}


def test_missing_corrupt_and_stale_projection(source_db: Path, tmp_path: Path):
    from gainlog_mcp.exporter import export_projection
    from gainlog_mcp.queries import query

    missing = tmp_path / "missing.db"
    assert query(missing, "get_data_coverage", {}) == {"error": "store_unavailable"}

    corrupt = tmp_path / "corrupt.db"
    corrupt.write_text("not sqlite")
    assert query(corrupt, "get_data_coverage", {}) == {"error": "store_corrupt"}

    stale = tmp_path / "stale.db"
    export_projection(source_db, stale, exported_at="2020-01-01T00:00:00Z")
    assert query(stale, "get_data_coverage", {})["stale"] is True
