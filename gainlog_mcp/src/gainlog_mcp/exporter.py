from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile


SCHEMA_VERSION = 1
APPLICATION_ID = 0x474C4D43  # GLMC

COPY_TABLES: dict[str, tuple[str, tuple[str, ...]]] = {
    "workout_session": ("workout_sessions", (
        "id", "date", "duration_minutes", "avg_heart_rate", "active_calories",
        "total_calories", "strength_duration_minutes", "strength_avg_heart_rate",
        "strength_active_calories", "strength_total_calories", "cardio_duration_minutes",
        "cardio_avg_heart_rate", "cardio_active_calories", "cardio_total_calories",
        "notes", "insight", "insight_json", "template_id", "effort", "pain",
    )),
    "exercise": ("exercises", (
        "id", "name", "kind", "cardio_duration_minutes", "distance_miles",
        "resistance_level", "session_id",
    )),
    "workout_set": ("workout_sets", ("id", "reps", "weight", "exercise_id")),
    "body_weight_entry": ("body_composition", (
        "id", "date", "weight_lbs", "body_fat_percent", "lean_body_mass_lbs",
        "bmi", "source", "source_record_id", "notes",
    )),
    "apple_health_daily": ("daily_health", (
        "date", "sleep_minutes", "deep_sleep_minutes", "core_sleep_minutes",
        "rem_sleep_minutes", "awake_minutes", "resting_heart_rate_bpm", "hrv_ms",
        "steps", "active_calories", "total_calories", "exercise_minutes", "stand_hours",
        "walking_running_miles", "source", "updated_at",
    )),
    "health_connect_daily_ownership": ("health_connect_ownership", ("date",)),
    "goal": ("goals", (
        "id", "kind", "title", "target_value", "minimum_value", "maximum_value",
        "unit", "start_date", "target_date", "status", "notes",
    )),
    "nutrition_entry": ("nutrition_entries", (
        "id", "date", "meal", "name", "calories", "protein_g", "carbs_g",
        "fat_g", "fiber_g", "notes",
    )),
    "daily_review": ("daily_reviews", ("date", "review", "generated_at")),
    "weekly_review": ("weekly_reviews", ("week_end", "week_start", "review", "generated_at")),
    "trend_summary": ("trend_summaries", ("cache_key", "summary", "model", "generated_at")),
    "google_health_daily_snapshot": ("google_daily_snapshots", (
        "date", "sleep_minutes", "deep_sleep_minutes", "core_sleep_minutes",
        "rem_sleep_minutes", "awake_minutes", "resting_heart_rate_bpm", "hrv_ms",
        "steps", "active_calories", "total_calories", "exercise_minutes",
        "walking_running_miles", "source_updated_at",
    )),
}

EXPECTED_SOURCE_TABLES = set(COPY_TABLES) | {
    "nutrition_sync_event", "google_health_oauth_state", "google_health_connection"
}

DDL = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE workout_sessions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, duration_minutes INTEGER NOT NULL,
  avg_heart_rate INTEGER, active_calories INTEGER, total_calories INTEGER,
  strength_duration_minutes INTEGER, strength_avg_heart_rate INTEGER,
  strength_active_calories INTEGER, strength_total_calories INTEGER,
  cardio_duration_minutes INTEGER, cardio_avg_heart_rate INTEGER,
  cardio_active_calories INTEGER, cardio_total_calories INTEGER,
  notes TEXT, insight TEXT, insight_json TEXT, template_id TEXT, effort TEXT,
  pain INTEGER NOT NULL CHECK (pain IN (0,1))
) WITHOUT ROWID;
CREATE TABLE exercises (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  cardio_duration_minutes INTEGER, distance_miles REAL, resistance_level REAL,
  session_id TEXT NOT NULL REFERENCES workout_sessions(id)
) WITHOUT ROWID;
CREATE TABLE workout_sets (
  id TEXT PRIMARY KEY, reps INTEGER NOT NULL, weight REAL NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id)
) WITHOUT ROWID;
CREATE TABLE body_composition (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, weight_lbs REAL NOT NULL,
  body_fat_percent REAL, lean_body_mass_lbs REAL, bmi REAL, source TEXT,
  source_record_id TEXT, notes TEXT
) WITHOUT ROWID;
CREATE TABLE daily_health (
  date TEXT PRIMARY KEY, sleep_minutes INTEGER, deep_sleep_minutes INTEGER,
  core_sleep_minutes INTEGER, rem_sleep_minutes INTEGER, awake_minutes INTEGER,
  resting_heart_rate_bpm REAL, hrv_ms REAL, steps INTEGER, active_calories REAL,
  total_calories REAL, exercise_minutes INTEGER, stand_hours INTEGER,
  walking_running_miles REAL, source TEXT NOT NULL, updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE google_daily_snapshots (
  date TEXT PRIMARY KEY, sleep_minutes INTEGER, deep_sleep_minutes INTEGER,
  core_sleep_minutes INTEGER, rem_sleep_minutes INTEGER, awake_minutes INTEGER,
  resting_heart_rate_bpm REAL, hrv_ms REAL, steps INTEGER, active_calories REAL,
  total_calories REAL, exercise_minutes INTEGER, walking_running_miles REAL,
  source_updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE health_connect_ownership (date TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE goals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, target_value REAL,
  minimum_value REAL, maximum_value REAL, unit TEXT, start_date TEXT NOT NULL,
  target_date TEXT, status TEXT NOT NULL, notes TEXT
) WITHOUT ROWID;
CREATE TABLE nutrition_entries (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL, name TEXT NOT NULL,
  calories INTEGER NOT NULL, protein_g REAL NOT NULL, carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL, fiber_g REAL NOT NULL, notes TEXT
) WITHOUT ROWID;
CREATE TABLE daily_reviews (
  date TEXT PRIMARY KEY, review TEXT NOT NULL, generated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE weekly_reviews (
  week_end TEXT PRIMARY KEY, week_start TEXT NOT NULL, review TEXT NOT NULL,
  generated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE trend_summaries (
  cache_key TEXT PRIMARY KEY, summary TEXT NOT NULL, model TEXT NOT NULL,
  generated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE source_connections (
  provider TEXT PRIMARY KEY, status TEXT NOT NULL, connected INTEGER NOT NULL,
  last_success_at TEXT, last_attempt_at TEXT, last_sync_count INTEGER NOT NULL,
  last_sync_start TEXT, last_sync_end TEXT
) WITHOUT ROWID;
CREATE INDEX ix_workouts_date ON workout_sessions(date DESC);
CREATE INDEX ix_exercises_session ON exercises(session_id);
CREATE INDEX ix_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX ix_body_date ON body_composition(date DESC);
CREATE INDEX ix_nutrition_date ON nutrition_entries(date DESC);
CREATE INDEX ix_goals_start ON goals(start_date DESC);
CREATE INDEX ix_daily_generated ON daily_reviews(generated_at DESC);
CREATE INDEX ix_weekly_generated ON weekly_reviews(generated_at DESC);
CREATE INDEX ix_trend_generated ON trend_summaries(generated_at DESC);
"""


class ExportError(Exception):
    pass


def _open_source(path: Path) -> tuple[sqlite3.Connection, os.stat_result]:
    try:
        if path.is_symlink():
            raise ExportError("source must be a regular file")
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            raise ExportError("source must be a regular file")
        uri = f"file:{path.resolve()}?mode=ro"
        db = sqlite3.connect(uri, uri=True)
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        return db, info
    except ExportError:
        raise
    except Exception as exc:
        raise ExportError("source unavailable") from exc


def _source_schema(db: sqlite3.Connection) -> dict[str, set[str]]:
    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    schema: dict[str, set[str]] = {}
    for table in tables:
        quoted = table.replace('"', '""')
        schema[table] = {row[1] for row in db.execute(f'PRAGMA table_info("{quoted}")')}
    return schema


def _validate_schema(db: sqlite3.Connection) -> dict[str, set[str]]:
    schema = _source_schema(db)
    if not EXPECTED_SOURCE_TABLES.issubset(schema):
        raise ExportError("source schema is incompatible")
    for source, (_, columns) in COPY_TABLES.items():
        if not set(columns).issubset(schema[source]):
            raise ExportError("source schema is incompatible")
    connection_columns = {
        "status", "encrypted_refresh_token", "last_success_at", "last_attempt_at",
        "last_sync_count", "last_sync_start", "last_sync_end",
    }
    if not connection_columns.issubset(schema["google_health_connection"]):
        raise ExportError("source schema is incompatible")
    return schema


def preflight(source: Path) -> dict[str, object]:
    db, _ = _open_source(source)
    try:
        schema = _validate_schema(db)
        row_counts = {}
        for table in sorted(schema):
            quoted = table.replace('"', '""')
            row_counts[table] = int(db.execute(f'SELECT COUNT(*) FROM "{quoted}"').fetchone()[0])
        return {
            "compatible": True,
            "table_count": len(schema),
            "row_counts": row_counts,
            "projection_schema_version": SCHEMA_VERSION,
        }
    finally:
        db.close()


def _iso_mtime(info: os.stat_result) -> str:
    return datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")


def _copy_rows(source: sqlite3.Connection, destination: sqlite3.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for source_table, (destination_table, columns) in COPY_TABLES.items():
        names = ",".join(f'"{column}"' for column in columns)
        placeholders = ",".join("?" for _ in columns)
        rows = source.execute(f'SELECT {names} FROM "{source_table}"').fetchall()
        destination.executemany(
            f'INSERT INTO "{destination_table}" ({names}) VALUES ({placeholders})', rows
        )
        counts[destination_table] = len(rows)

    connection = source.execute(
        """
        SELECT status,
               CASE WHEN status = 'connected' AND encrypted_refresh_token IS NOT NULL
                    THEN 1 ELSE 0 END,
               last_success_at, last_attempt_at, COALESCE(last_sync_count, 0),
               last_sync_start, last_sync_end
          FROM google_health_connection
         WHERE id = 'primary'
        """
    ).fetchone()
    if connection is not None:
        destination.execute(
            "INSERT INTO source_connections VALUES (?,?,?,?,?,?,?,?)",
            ("google-health", *connection),
        )
    counts["source_connections"] = 1 if connection is not None else 0
    return counts


def export_projection(
    source: Path,
    destination: Path,
    *,
    exported_at: str | None = None,
) -> dict[str, object]:
    source = Path(source)
    destination = Path(destination)
    if destination.is_symlink():
        raise ExportError("destination must not be a symlink")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    exported_at = exported_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    source_db, source_info = _open_source(source)
    temporary: str | None = None
    try:
        _validate_schema(source_db)
        fd, temporary = tempfile.mkstemp(prefix=".gainlog-projection-", dir=destination.parent)
        os.close(fd)
        projection = sqlite3.connect(temporary)
        try:
            projection.executescript(DDL)
            counts = _copy_rows(source_db, projection)
            projection.executemany(
                "INSERT INTO metadata(key,value) VALUES (?,?)",
                [
                    ("schema_version", str(SCHEMA_VERSION)),
                    ("exported_at", exported_at),
                    ("source_db_modified_at", _iso_mtime(source_info)),
                ],
            )
            projection.execute(f"PRAGMA application_id={APPLICATION_ID}")
            projection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            violations = projection.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise ExportError("projection integrity check failed")
            projection.commit()
        finally:
            projection.close()
        os.chmod(temporary, 0o640)
        with open(temporary, "rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        temporary = None
        directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"schema_version": SCHEMA_VERSION, "table_counts": counts}
    except ExportError:
        raise
    except Exception as exc:
        raise ExportError("projection export failed") from exc
    finally:
        source_db.close()
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Export an allowlisted GainLog read-only projection")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    try:
        if args.preflight:
            print(json.dumps(preflight(args.source), sort_keys=True, separators=(",", ":")))
        elif args.destination is not None:
            export_projection(args.source, args.destination)
        else:
            raise ExportError("destination is required")
    except Exception:
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
