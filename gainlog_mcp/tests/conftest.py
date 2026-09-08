from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest


CANARY = "CANARY_SECRET_TOKEN_ROW_DO_NOT_EXPORT"


@pytest.fixture
def source_db(tmp_path: Path) -> Path:
    path = tmp_path / "source.db"
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE workout_session (
          id TEXT PRIMARY KEY, date TEXT, duration_minutes INTEGER,
          avg_heart_rate INTEGER, active_calories INTEGER, total_calories INTEGER,
          strength_duration_minutes INTEGER, strength_avg_heart_rate INTEGER,
          strength_active_calories INTEGER, strength_total_calories INTEGER,
          cardio_duration_minutes INTEGER, cardio_avg_heart_rate INTEGER,
          cardio_active_calories INTEGER, cardio_total_calories INTEGER,
          notes TEXT, insight TEXT, insight_json TEXT, template_id TEXT,
          effort TEXT, pain BOOLEAN
        );
        CREATE TABLE exercise (
          id TEXT PRIMARY KEY, name TEXT, kind TEXT, cardio_duration_minutes INTEGER,
          distance_miles REAL, resistance_level REAL, session_id TEXT
        );
        CREATE TABLE workout_set (
          id TEXT PRIMARY KEY, reps INTEGER, weight REAL, exercise_id TEXT
        );
        CREATE TABLE body_weight_entry (
          id TEXT PRIMARY KEY, date TEXT, weight_lbs REAL, body_fat_percent REAL,
          lean_body_mass_lbs REAL, bmi REAL, source TEXT, source_record_id TEXT, notes TEXT
        );
        CREATE TABLE apple_health_daily (
          date TEXT PRIMARY KEY, sleep_minutes INTEGER, deep_sleep_minutes INTEGER,
          core_sleep_minutes INTEGER, rem_sleep_minutes INTEGER, awake_minutes INTEGER,
          resting_heart_rate_bpm REAL, hrv_ms REAL, steps INTEGER,
          active_calories REAL, total_calories REAL, exercise_minutes INTEGER,
          stand_hours INTEGER, walking_running_miles REAL, source TEXT, updated_at TEXT
        );
        CREATE TABLE health_connect_daily_ownership (date TEXT PRIMARY KEY);
        CREATE TABLE goal (
          id TEXT PRIMARY KEY, kind TEXT, title TEXT, target_value REAL,
          minimum_value REAL, maximum_value REAL, unit TEXT, start_date TEXT,
          target_date TEXT, status TEXT, notes TEXT
        );
        CREATE TABLE nutrition_entry (
          id TEXT PRIMARY KEY, date TEXT, meal TEXT, name TEXT, calories INTEGER,
          protein_g REAL, carbs_g REAL, fat_g REAL, fiber_g REAL, notes TEXT
        );
        CREATE TABLE nutrition_sync_event (
          cursor INTEGER PRIMARY KEY, operation TEXT, entry_id TEXT, payload_json TEXT
        );
        CREATE TABLE daily_review (date TEXT PRIMARY KEY, review TEXT, generated_at TEXT);
        CREATE TABLE weekly_review (
          week_end TEXT PRIMARY KEY, week_start TEXT, review TEXT, generated_at TEXT
        );
        CREATE TABLE trend_summary (
          cache_key TEXT PRIMARY KEY, data_hash TEXT, summary TEXT, model TEXT, generated_at TEXT
        );
        CREATE TABLE google_health_oauth_state (
          state TEXT PRIMARY KEY, code_verifier TEXT, expires_at TEXT, consumed_at TEXT
        );
        CREATE TABLE google_health_connection (
          id TEXT PRIMARY KEY, encrypted_refresh_token TEXT, status TEXT,
          last_success_at TEXT, last_attempt_at TEXT, last_error TEXT,
          last_sync_count INTEGER, last_sync_start TEXT, last_sync_end TEXT
        );
        CREATE TABLE google_health_daily_snapshot (
          date TEXT PRIMARY KEY, sleep_minutes INTEGER, deep_sleep_minutes INTEGER,
          core_sleep_minutes INTEGER, rem_sleep_minutes INTEGER, awake_minutes INTEGER,
          resting_heart_rate_bpm REAL, hrv_ms REAL, steps INTEGER,
          active_calories REAL, total_calories REAL, exercise_minutes INTEGER,
          walking_running_miles REAL, source_updated_at TEXT
        );
        """
    )
    db.execute(
        "INSERT INTO workout_session VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("workout-1", "2026-09-01T06:00:00-04:00", 45, 120, 300, 400,
         30, 115, 200, 280, 15, 130, 100, 120, "synthetic notes",
         "synthetic insight", None, "push", "right", 0),
    )
    db.execute(
        "INSERT INTO exercise VALUES (?,?,?,?,?,?,?)",
        ("exercise-1", "Synthetic Press", "strength", None, None, None, "workout-1"),
    )
    db.execute(
        "INSERT INTO workout_set VALUES (?,?,?,?)",
        ("set-1", 0, 0.0, "exercise-1"),
    )
    db.execute(
        "INSERT INTO body_weight_entry VALUES (?,?,?,?,?,?,?,?,?)",
        ("weight-1", "2026-09-02T07:00:00-04:00", 200.0, None, 150.0, 25.0,
         "health-connect", "synthetic-record", None),
    )
    db.execute(
        "INSERT INTO apple_health_daily VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("2026-09-02", None, 0, None, None, 10, 55.0, 42.0, 0, 0.0,
         None, 0, None, 0.0, "health-connect", "2026-09-02T12:00:00Z"),
    )
    db.execute("INSERT INTO health_connect_daily_ownership VALUES (?)", ("2026-09-02",))
    db.execute(
        "INSERT INTO goal VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("goal-1", "protein", "Synthetic protein", 170.0, 160.0, 180.0, "g",
         "2026-09-01", None, "active", None),
    )
    db.execute(
        "INSERT INTO nutrition_entry VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("food-1", "2026-09-02T08:00:00-04:00", "breakfast", "Synthetic oats",
         300, 20.0, 40.0, 5.0, 10.0, None),
    )
    db.execute(
        "INSERT INTO nutrition_sync_event VALUES (?,?,?,?)",
        (1, "upsert", "food-1", CANARY),
    )
    db.execute(
        "INSERT INTO daily_review VALUES (?,?,?)",
        ("2026-09-02", "Synthetic daily review.", "2026-09-03T00:00:00Z"),
    )
    db.execute(
        "INSERT INTO weekly_review VALUES (?,?,?,?)",
        ("2026-09-06", "2026-08-31", "Synthetic weekly review.", "2026-09-07T00:00:00Z"),
    )
    db.execute(
        "INSERT INTO trend_summary VALUES (?,?,?,?,?)",
        ("recovery:sleep:7D:synthetic-hash", "hidden-hash", "Synthetic trend.",
         "synthetic-model", "2026-09-03T00:00:00Z"),
    )
    db.execute(
        "INSERT INTO google_health_oauth_state VALUES (?,?,?,?)",
        (CANARY, CANARY, "2026-09-03T00:00:00Z", None),
    )
    db.execute(
        "INSERT INTO google_health_connection VALUES (?,?,?,?,?,?,?,?,?)",
        ("primary", CANARY, "connected", "2026-09-02T12:00:00Z",
         "2026-09-02T12:00:00Z", CANARY, 1, "2026-09-01", "2026-09-02"),
    )
    db.execute(
        "INSERT INTO google_health_daily_snapshot VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("2026-09-02", 420, None, None, None, None, 54.0, 43.0, 1000,
         200.0, 1900.0, 20, 1.5, "2026-09-02T11:00:00Z"),
    )
    db.commit()
    db.close()
    return path


@pytest.fixture
def projection(source_db: Path, tmp_path: Path) -> Path:
    from gainlog_mcp.exporter import export_projection

    destination = tmp_path / "projection.db"
    export_projection(source_db, destination, exported_at="2026-09-08T16:00:00Z")
    return destination


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
