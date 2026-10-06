"""Versioned, cross-dialect GainLog schema setup."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, MetaData, Table, inspect, select, text
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel

CURRENT_SCHEMA_VERSION = 2

_VERSION_METADATA = MetaData()
_VERSION_TABLE = Table(
    "gainlog_schema_version",
    _VERSION_METADATA,
    Column("version", Integer, primary_key=True),
    Column("applied_at", DateTime(timezone=True), nullable=False),
)

_LEGACY_SQLITE_COLUMNS = (
    "ALTER TABLE workout_session ADD COLUMN insight TEXT",
    "ALTER TABLE exercise ADD COLUMN kind TEXT DEFAULT 'strength'",
    "ALTER TABLE exercise ADD COLUMN cardio_duration_minutes INTEGER",
    "ALTER TABLE exercise ADD COLUMN distance_miles REAL",
    "ALTER TABLE exercise ADD COLUMN resistance_level REAL",
    "ALTER TABLE exercise ADD COLUMN incline_percent REAL",
    "ALTER TABLE exercise ADD COLUMN target_reps_min INTEGER",
    "ALTER TABLE exercise ADD COLUMN target_reps_max INTEGER",
    "ALTER TABLE exercise ADD COLUMN prescribed_sets INTEGER",
    "ALTER TABLE exercise ADD COLUMN position INTEGER DEFAULT 0",
    "ALTER TABLE workout_set ADD COLUMN position INTEGER DEFAULT 0",
    "ALTER TABLE workout_session ADD COLUMN strength_duration_minutes INTEGER",
    "ALTER TABLE workout_session ADD COLUMN strength_avg_heart_rate INTEGER",
    "ALTER TABLE workout_session ADD COLUMN strength_active_calories INTEGER",
    "ALTER TABLE workout_session ADD COLUMN total_calories INTEGER",
    "ALTER TABLE workout_session ADD COLUMN strength_total_calories INTEGER",
    "ALTER TABLE workout_session ADD COLUMN cardio_duration_minutes INTEGER",
    "ALTER TABLE workout_session ADD COLUMN cardio_avg_heart_rate INTEGER",
    "ALTER TABLE workout_session ADD COLUMN cardio_active_calories INTEGER",
    "ALTER TABLE workout_session ADD COLUMN cardio_total_calories INTEGER",
    "ALTER TABLE workout_session ADD COLUMN insight_json TEXT",
    "ALTER TABLE workout_session ADD COLUMN template_id TEXT",
    "ALTER TABLE workout_session ADD COLUMN effort TEXT",
    "ALTER TABLE workout_session ADD COLUMN pain BOOLEAN DEFAULT 0",
    "ALTER TABLE nutrition_entry ADD COLUMN fiber_g REAL DEFAULT 0",
    "ALTER TABLE nutrition_entry ADD COLUMN position INTEGER DEFAULT 0",
    "ALTER TABLE body_weight_entry ADD COLUMN body_fat_percent REAL",
    "ALTER TABLE body_weight_entry ADD COLUMN lean_body_mass_lbs REAL",
    "ALTER TABLE body_weight_entry ADD COLUMN bmi REAL",
    "ALTER TABLE body_weight_entry ADD COLUMN source TEXT",
    "ALTER TABLE body_weight_entry ADD COLUMN source_record_id TEXT",
    "ALTER TABLE goal ADD COLUMN minimum_value REAL",
    "ALTER TABLE goal ADD COLUMN maximum_value REAL",
    "ALTER TABLE apple_health_daily ADD COLUMN total_calories REAL",
)


def _upgrade_legacy_sqlite(engine: Engine) -> None:
    existing = set(inspect(engine).get_table_names())
    if "workout_session" not in existing:
        return
    with engine.begin() as connection:
        for statement in _LEGACY_SQLITE_COLUMNS:
            parts = statement.split()
            table_name = parts[2]
            column_name = parts[5]
            quoted_table = table_name.replace('"', '""')
            existing_columns = {
                row[1]
                for row in connection.execute(text(f'PRAGMA table_info("{quoted_table}")'))
            }
            if column_name not in existing_columns:
                connection.execute(text(statement))
        connection.execute(text(
            "UPDATE exercise SET position = ("
            "SELECT COUNT(*) - 1 FROM exercise AS ordered "
            "WHERE ordered.session_id = exercise.session_id "
            "AND ordered.rowid <= exercise.rowid)"
        ))
        connection.execute(text(
            "UPDATE workout_set SET position = ("
            "SELECT COUNT(*) - 1 FROM workout_set AS ordered "
            "WHERE ordered.exercise_id = workout_set.exercise_id "
            "AND ordered.rowid <= workout_set.rowid)"
        ))
        connection.execute(text(
            "UPDATE nutrition_entry SET position = ("
            "SELECT COUNT(*) - 1 FROM nutrition_entry AS ordered "
            "WHERE ordered.rowid <= nutrition_entry.rowid)"
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_body_weight_source_record "
            "ON body_weight_entry (source, source_record_id)"
        ))
        connection.execute(text(
            "INSERT OR IGNORE INTO health_connect_daily_ownership (date) "
            "SELECT date FROM apple_health_daily WHERE source = 'health-connect'"
        ))


def apply_schema_migrations(engine: Engine) -> list[int]:
    """Apply versioned schema changes atomically and return applied versions."""
    dialect = engine.dialect.name
    if dialect == "sqlite":
        _upgrade_legacy_sqlite(engine)
    elif dialect != "postgresql":
        raise RuntimeError(f"unsupported database dialect: {dialect}")

    _VERSION_METADATA.create_all(engine)
    applied: list[int] = []
    with engine.begin() as connection:
        if dialect == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(1196183367)"))
            if "exercise" in inspect(connection).get_table_names():
                for column in ("target_reps_min", "target_reps_max", "prescribed_sets"):
                    connection.execute(text(f"ALTER TABLE exercise ADD COLUMN IF NOT EXISTS {column} INTEGER"))
        versions = set(connection.execute(select(_VERSION_TABLE.c.version)).scalars())
        SQLModel.metadata.create_all(connection)
        # Keep this invariant explicit because SQLModel does not describe the
        # nullable source identity's uniqueness in model metadata.
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_body_weight_source_record "
            "ON body_weight_entry (source, source_record_id)"
        ))
        if 1 not in versions:
            connection.execute(_VERSION_TABLE.insert().values(
                version=1, applied_at=datetime.now(timezone.utc),
            ))
            applied.append(1)
        if 2 not in versions:
            # PostgreSQL INTEGER overflows when the database exceeds 2 GiB.
            # SQLite INTEGER already holds signed 64-bit values; new tables
            # use BIGINT via the model above.
            if dialect == "postgresql":
                connection.execute(text(
                    "ALTER TABLE health_v2_import_run "
                    "ALTER COLUMN db_bytes_before TYPE BIGINT, "
                    "ALTER COLUMN db_bytes_after TYPE BIGINT"
                ))
            connection.execute(_VERSION_TABLE.insert().values(
                version=2, applied_at=datetime.now(timezone.utc),
            ))
            applied.append(2)
    return applied
