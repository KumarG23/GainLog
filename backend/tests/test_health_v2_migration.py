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
