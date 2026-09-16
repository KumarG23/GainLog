"""Create the additive GainLog V2 shadow-health foundation tables.

This migration is intentionally non-destructive and idempotent. It neither
changes legacy daily-health tables nor enables the V2 importer.
"""
from __future__ import annotations

import json

from sqlalchemy import inspect
from sqlmodel import SQLModel

from ..health_v2_models import V2_HEALTH_MODELS
from ..main import engine


def migrate(target_engine=engine) -> dict[str, object]:
    before = set(inspect(target_engine).get_table_names())
    tables = [model.__table__ for model in V2_HEALTH_MODELS]
    SQLModel.metadata.create_all(target_engine, tables=tables)
    after = set(inspect(target_engine).get_table_names())
    expected = {table.name for table in tables}
    missing = sorted(expected - after)
    if missing:
        raise RuntimeError("GainLog V2 migration did not create all expected tables")
    return {
        "status": "ok",
        "created": sorted((after - before) & expected),
        "present": sorted(expected),
    }


def main() -> int:
    print(json.dumps(migrate(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
