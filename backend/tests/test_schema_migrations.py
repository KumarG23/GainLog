from sqlalchemy import BigInteger, inspect, text
from sqlmodel import SQLModel, Session, create_engine

# Importing main registers the complete application metadata.
from backend import main  # noqa: F401
from backend.health_v2_models import HealthImportRunDB
from backend.migrations.schema import CURRENT_SCHEMA_VERSION, apply_schema_migrations


def test_versioned_schema_setup_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'schema.db'}")

    first = apply_schema_migrations(engine)
    second = apply_schema_migrations(engine)

    assert CURRENT_SCHEMA_VERSION == 8
    assert first == [1, 2, 3, 4, 5, 6, 7, 8]
    assert second == []
    assert "cardio_analysis_json" in {column['name'] for column in inspect(engine).get_columns('workout_session')}
    assert "gainlog_schema_version" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT version FROM gainlog_schema_version ORDER BY version")
        ).scalars().all() == [1, 2, 3, 4, 5, 6, 7, 8]


def test_v4_cardio_column_adds_to_existing_v3_workouts(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cardio-upgrade.db'}")
    apply_schema_migrations(engine)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO workout_session (id,date,duration_minutes,pain) "
                                "VALUES ('old','2026-10-01',30,0)"))
        connection.execute(text("DELETE FROM gainlog_schema_version WHERE version=4"))
        connection.execute(text("ALTER TABLE workout_session DROP COLUMN cardio_analysis_json"))
    assert apply_schema_migrations(engine) == [4]
    assert apply_schema_migrations(engine) == []
    with engine.connect() as connection:
        assert connection.execute(text("SELECT cardio_analysis_json FROM workout_session WHERE id='old'")).scalar_one() is None


def test_v5_cardio_windows_upgrade_preserves_existing_exercises(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cardio-window-upgrade.db'}")
    apply_schema_migrations(engine)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO workout_session (id,date,duration_minutes,pain) "
                                "VALUES ('old','2026-10-01',20,0)"))
        connection.execute(text("INSERT INTO exercise (id,name,session_id,position,kind) "
                                "VALUES ('ex','Treadmill','old',0,'cardio')"))
        connection.execute(text("DELETE FROM gainlog_schema_version WHERE version=5"))
        connection.execute(text("ALTER TABLE exercise DROP COLUMN cardio_started_at"))
        connection.execute(text("ALTER TABLE exercise DROP COLUMN cardio_ended_at"))
    assert apply_schema_migrations(engine) == [5]
    assert apply_schema_migrations(engine) == []
    with engine.connect() as connection:
        assert connection.execute(text("SELECT name,cardio_started_at,cardio_ended_at "
                                       "FROM exercise WHERE id='ex'")).one() == ('Treadmill', None, None)


def test_timed_set_migration_preserves_existing_reps(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'timed.db'}")
    apply_schema_migrations(engine)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO workout_session (id,date,duration_minutes,pain) VALUES ('old','2026-10-01',30,0)"))
        connection.execute(text("INSERT INTO exercise (id,name,session_id,position,kind) VALUES ('ex','Press','old',0,'strength')"))
        connection.execute(text("DELETE FROM gainlog_schema_version WHERE version=3"))
        connection.execute(text("ALTER TABLE workout_set DROP COLUMN seconds"))
        connection.execute(text("ALTER TABLE workout_set DROP COLUMN measure"))
        connection.execute(text("INSERT INTO workout_set (id,exercise_id,reps,weight,position) VALUES ('set','ex',8,50,0)"))
    assert apply_schema_migrations(engine) == [3]
    assert apply_schema_migrations(engine) == []
    with engine.connect() as connection:
        assert connection.execute(text("SELECT reps,weight,measure,seconds FROM workout_set WHERE id='set'")).one() == (8, 50, 'reps', None)


def test_v2_size_columns_support_database_above_two_gib(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'large.db'}")
    apply_schema_migrations(engine)
    table = SQLModel.metadata.tables["health_v2_import_run"]
    assert isinstance(table.c.db_bytes_before.type, BigInteger)
    assert isinstance(table.c.db_bytes_after.type, BigInteger)
    with Session(engine) as session:
        session.add(HealthImportRunDB(
            id="large-db", requested_start="2026-10-01", requested_end="2026-10-02",
            started_at="2026-10-02T00:00:00Z", status="complete",
            db_bytes_before=2_169_437_207, db_bytes_after=2_169_437_208,
        ))
        session.commit()
        row = session.get(HealthImportRunDB, "large-db")
        assert row is not None
        assert (row.db_bytes_before, row.db_bytes_after) == (2_169_437_207, 2_169_437_208)


def test_upgrade_existing_v1_schema_preserves_import_runs(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'upgrade.db'}")
    apply_schema_migrations(engine)
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM gainlog_schema_version WHERE version = 2"))
    assert apply_schema_migrations(engine) == [2]
    assert apply_schema_migrations(engine) == []


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
