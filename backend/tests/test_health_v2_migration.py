import json
import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import inspect
from sqlmodel import create_engine

from backend.health_v2_models import V2_HEALTH_MODELS
from backend.migrations.health_v2_foundation import migrate


def test_health_v2_foundation_migration_is_additive_and_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")

    first = migrate(engine)
    second = migrate(engine)

    expected = {model.__table__.name for model in V2_HEALTH_MODELS}
    assert set(first["created"]) == expected
    assert set(first["present"]) == expected
    assert second["created"] == []
    assert expected <= set(inspect(engine).get_table_names())


def test_health_v2_migration_runs_from_production_flat_module_layout(tmp_path):
    root = Path(__file__).resolve().parents[2]
    db_path = tmp_path / "flat-layout.db"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root / "backend")
    env["GAINLOG_DATABASE_URL"] = f"sqlite:///{db_path}"

    completed = subprocess.run(
        [sys.executable, "-m", "migrations.health_v2_foundation"],
        cwd=root,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    result = json.loads(completed.stdout)
    assert len(result["created"]) == len(V2_HEALTH_MODELS)


def test_health_v2_sync_cli_imports_from_production_flat_module_layout():
    root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root / "backend")

    completed = subprocess.run(
        [sys.executable, "-m", "google_health_v2_sync", "--help"],
        cwd=root,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "bounded Google Health V2 shadow import" in completed.stdout
