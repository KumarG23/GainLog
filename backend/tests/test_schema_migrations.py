from sqlalchemy import inspect, text
from sqlmodel import SQLModel, create_engine

# Importing main registers the complete application metadata.
from backend import main  # noqa: F401
from backend.migrations.schema import CURRENT_SCHEMA_VERSION, apply_schema_migrations


def test_versioned_schema_setup_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'schema.db'}")

    first = apply_schema_migrations(engine)
    second = apply_schema_migrations(engine)

    assert first == [CURRENT_SCHEMA_VERSION]
    assert second == []
    assert "gainlog_schema_version" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT version FROM gainlog_schema_version ORDER BY version")
        ).scalars().all() == [CURRENT_SCHEMA_VERSION]


def test_legacy_sqlite_workout_order_is_materialized_before_postgres_migration(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE workout_set"))
        connection.execute(text("DROP TABLE exercise"))
        connection.execute(text("DROP TABLE workout_session"))
        connection.execute(text("DROP TABLE nutrition_entry"))
        connection.execute(text(
            "CREATE TABLE workout_session (id TEXT PRIMARY KEY, date TEXT NOT NULL, "
            "duration_minutes INTEGER NOT NULL, notes TEXT)"
        ))
        connection.execute(text(
            "CREATE TABLE exercise (id TEXT PRIMARY KEY, name TEXT NOT NULL, "
            "session_id TEXT NOT NULL)"
        ))
        connection.execute(text(
            "CREATE TABLE workout_set (id TEXT PRIMARY KEY, reps INTEGER NOT NULL, "
            "weight REAL NOT NULL, exercise_id TEXT NOT NULL)"
        ))
        connection.execute(text(
            "CREATE TABLE nutrition_entry (id TEXT PRIMARY KEY, date TEXT NOT NULL, "
            "meal TEXT NOT NULL, name TEXT NOT NULL, calories INTEGER NOT NULL, "
            "protein_g REAL NOT NULL, carbs_g REAL NOT NULL, fat_g REAL NOT NULL, "
            "fiber_g REAL DEFAULT 0, notes TEXT)"
        ))
        connection.execute(text(
            "INSERT INTO workout_session (id,date,duration_minutes) VALUES "
            "('session','2026-09-18',30)"
        ))
        connection.execute(text(
            "INSERT INTO exercise (id,name,session_id) VALUES "
            "('z-first','First','session'),('a-second','Second','session')"
        ))
        connection.execute(text(
            "INSERT INTO workout_set (id,reps,weight,exercise_id) VALUES "
            "('z-first',5,100,'z-first'),('a-second',6,90,'z-first')"
        ))
        connection.execute(text(
            "INSERT INTO nutrition_entry "
            "(id,date,meal,name,calories,protein_g,carbs_g,fat_g) VALUES "
            "('z-first','2026-09-18','breakfast','First',100,10,10,1),"
            "('a-second','2026-09-18','lunch','Second',200,20,20,2)"
        ))

    apply_schema_migrations(engine)

    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT id, position FROM exercise ORDER BY position")
        ).all() == [("z-first", 0), ("a-second", 1)]
        assert connection.execute(
            text("SELECT id, position FROM workout_set ORDER BY position")
        ).all() == [("z-first", 0), ("a-second", 1)]
        assert connection.execute(
            text("SELECT id, position FROM nutrition_entry ORDER BY position")
        ).all() == [("z-first", 0), ("a-second", 1)]
