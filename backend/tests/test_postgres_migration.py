from pathlib import Path

import pytest
from sqlalchemy import text
from sqlmodel import Session, create_engine, select

from backend import main
from backend.google_health_v2 import GoogleHealthV2Importer
from backend.health_v2_models import (
    HealthImportRunDB,
    HealthIntervalObservationDB,
    HealthMinuteSummaryDB,
    HealthSampleObservationDB,
)
import backend.migrate_sqlite_to_postgres as migrator
from backend.migrate_sqlite_to_postgres import MigrationError, migrate_database
from backend.migrations.schema import apply_schema_migrations


POSTGRES_URL = __import__("os").environ.get("GAINLOG_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="disposable PostgreSQL is not configured")


def _source(path: Path) -> None:
    engine = create_engine(f"sqlite:///{path}")
    apply_schema_migrations(engine)
    with Session(engine) as session:
        session.add(main.WorkoutSessionDB(id="workout-1", date="2026-09-01", duration_minutes=30))
        session.add(main.ExerciseDB(id="exercise-1", name="Press", session_id="workout-1"))
        session.add(main.WorkoutSetDB(id="set-1", reps=5, weight=100, exercise_id="exercise-1"))
        session.add(main.NutritionSyncEventDB(cursor=7, operation="upsert", entry_id="food-1"))
        session.commit()


def test_copy_batches_stay_below_postgresql_parameter_limit():
    assert migrator._bounded_batch_size(HealthIntervalObservationDB.__table__, 5_000) == 2_978
    assert migrator._bounded_batch_size(main.WorkoutSetDB.__table__, 1_000) == 1_000


def test_bounded_migration_validates_parity_repairs_sequences_and_resumes(tmp_path):
    source = tmp_path / "source.db"
    _source(source)
    target = create_engine(POSTGRES_URL)
    with target.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))

    receipt = migrate_database(source, POSTGRES_URL, batch_size=2)

    assert receipt["status"] == "ok"
    assert receipt["batch_size"] == 2
    assert receipt["counts"]["workout_session"] == 1
    assert receipt["counts"]["exercise"] == 1
    assert receipt["validation"] == "counts-pks-hashes-foreign-keys"

    with target.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM workout_set")).scalar_one() == 1
        assert connection.execute(
            text("SELECT nextval(pg_get_serial_sequence('nutrition_sync_event', 'cursor'))")
        ).scalar_one() > 7

    resumed = migrate_database(source, POSTGRES_URL, batch_size=1, resume=True)
    assert resumed["counts"] == receipt["counts"]
    with pytest.raises(MigrationError, match="target is not empty"):
        migrate_database(source, POSTGRES_URL, batch_size=2)


def test_postgresql_minute_summary_groups_by_the_selected_minute_expression():
    target = create_engine(POSTGRES_URL)
    with target.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    apply_schema_migrations(target)

    with Session(target) as session:
        run = HealthImportRunDB(
            id="minute-run",
            requested_start="2026-09-01",
            requested_end="2026-09-02",
            started_at="2026-09-02T00:00:00Z",
            status="running",
        )
        session.add(run)
        session.add(
            HealthSampleObservationDB(
                id="sample-1",
                provenance="source_raw",
                data_type="heart_rate",
                observed_at_utc="2026-09-01T12:34:56Z",
                local_date="2026-09-01",
                numeric_value=72,
                unit="bpm",
                payload_hash="sample-hash",
                import_run_id=run.id,
                ingested_at="2026-09-02T00:00:00Z",
            )
        )
        session.commit()

        GoogleHealthV2Importer(
            session,
            object(),
            "unused-token",
            run,
            "2026-09-01",
            "2026-09-02",
        ).build_minute_summaries()

        summaries = session.exec(select(HealthMinuteSummaryDB)).all()
        assert len(summaries) == 1
        assert summaries[0].minute_utc == "2026-09-01T12:34:00Z"
        assert summaries[0].average == 72
