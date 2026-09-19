"""Bounded, resumable SQLite-to-PostgreSQL GainLog migration."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import Integer, Table, create_engine, func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.engine import Connection, Engine
from sqlmodel import SQLModel

try:
    from . import main as _models  # noqa: F401 - registers application metadata
    from .migrations.schema import apply_schema_migrations
except ImportError:
    import main as _models  # type: ignore[no-redef]  # noqa: F401
    from migrations.schema import apply_schema_migrations


class MigrationError(RuntimeError):
    pass


_POSTGRESQL_MAX_PARAMETERS = 65_535


def _bounded_batch_size(table: Table, requested: int) -> int:
    """Keep a multi-row INSERT below PostgreSQL's protocol parameter cap."""
    columns_per_row = len(table.columns)
    if columns_per_row < 1:
        raise MigrationError(f"table {table.name} has no columns")
    return min(requested, max(1, _POSTGRESQL_MAX_PARAMETERS // columns_per_row))


def _source_engine(path: Path) -> Engine:
    resolved = path.resolve()
    if not resolved.is_file() or path.is_symlink():
        raise MigrationError("source must be a regular SQLite file")
    return create_engine(
        "sqlite://",
        creator=lambda: sqlite3.connect(f"file:{resolved}?mode=ro", uri=True),
    )


def _validate_source(connection: Connection) -> set[str]:
    if connection.execute(text("PRAGMA quick_check")).scalar_one() != "ok":
        raise MigrationError("source SQLite integrity check failed")
    if connection.execute(text("PRAGMA foreign_key_check")).all():
        raise MigrationError("source SQLite foreign keys are invalid")
    return set(inspect(connection).get_table_names())


def _application_tables(source_names: set[str]) -> list[Table]:
    excluded = {"gainlog_schema_version"}
    tables = [
        table for table in SQLModel.metadata.sorted_tables
        if table.name in source_names and table.name not in excluded and not table.name.startswith("test_")
    ]
    expected = {
        table.name for table in SQLModel.metadata.tables.values()
        if not table.name.startswith("test_")
    }
    missing = expected - source_names
    if missing:
        raise MigrationError("source schema is incomplete")
    return tables


def _target_row_count(connection: Connection, tables: Iterable[Table]) -> int:
    return sum(int(connection.execute(select(func.count()).select_from(table)).scalar_one()) for table in tables)


def _copy_table(
    source: Connection,
    target: Connection,
    table: Table,
    batch_size: int,
) -> int:
    primary_key = list(table.primary_key.columns)
    if not primary_key:
        raise MigrationError(f"table {table.name} has no primary key")
    statement = select(table).order_by(*primary_key)
    effective_batch_size = _bounded_batch_size(table, batch_size)
    count = 0
    result = source.execution_options(stream_results=True).execute(statement)
    while True:
        rows = [dict(row._mapping) for row in result.fetchmany(effective_batch_size)]
        if not rows:
            break
        target.execute(postgresql_insert(table).values(rows).on_conflict_do_nothing())
        count += len(rows)
    return count


def _canonical(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def _table_signature(connection: Connection, table: Table, batch_size: int) -> tuple[int, str]:
    primary_key = list(table.primary_key.columns)
    digest = hashlib.sha256()
    count = 0
    result = connection.execution_options(stream_results=True).execute(
        select(table).order_by(*primary_key)
    )
    while True:
        rows = result.fetchmany(batch_size)
        if not rows:
            break
        for row in rows:
            payload = [_canonical(value) for value in row]
            digest.update(json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode())
            digest.update(b"\n")
            count += 1
    return count, digest.hexdigest()


def _repair_sequences(connection: Connection, tables: Iterable[Table]) -> None:
    for table in tables:
        for column in table.primary_key.columns:
            if not isinstance(column.type, Integer):
                continue
            sequence = connection.execute(
                text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                {"table_name": table.name, "column_name": column.name},
            ).scalar_one_or_none()
            if sequence is None:
                continue
            maximum = connection.execute(select(func.max(column))).scalar_one()
            connection.execute(
                text("SELECT setval(CAST(:sequence AS regclass), :value, :called)"),
                {
                    "sequence": sequence,
                    "value": int(maximum) if maximum is not None else 1,
                    "called": maximum is not None,
                },
            )


def _validate_target_foreign_keys(connection: Connection) -> None:
    invalid = connection.execute(text(
        "SELECT conname FROM pg_constraint "
        "WHERE contype = 'f' AND connamespace = current_schema()::regnamespace "
        "AND NOT convalidated"
    )).all()
    if invalid:
        raise MigrationError("target PostgreSQL foreign keys are not validated")


def migrate_database(
    source_path: Path,
    target_url: str,
    *,
    batch_size: int = 1_000,
    resume: bool = False,
) -> dict[str, Any]:
    if not 1 <= batch_size <= 10_000:
        raise MigrationError("batch size must be between 1 and 10000")
    target_engine = create_engine(target_url)
    if target_engine.dialect.name != "postgresql":
        raise MigrationError("target must be PostgreSQL")
    source_engine = _source_engine(Path(source_path))

    with source_engine.connect() as source:
        source_names = _validate_source(source)
        tables = _application_tables(source_names)
        apply_schema_migrations(target_engine)
        with target_engine.connect() as target:
            if _target_row_count(target, tables) and not resume:
                raise MigrationError("target is not empty; use verified resume mode")

        counts: dict[str, int] = {}
        for table in tables:
            with target_engine.begin() as target:
                counts[table.name] = _copy_table(source, target, table, batch_size)

        with target_engine.begin() as target:
            _repair_sequences(target, tables)
            _validate_target_foreign_keys(target)
            for table in tables:
                source_signature = _table_signature(source, table, batch_size)
                target_signature = _table_signature(target, table, batch_size)
                if source_signature != target_signature:
                    raise MigrationError(f"parity validation failed for table {table.name}")

    return {
        "status": "ok",
        "batch_size": batch_size,
        "resumed": resume,
        "counts": counts,
        "validation": "counts-pks-hashes-foreign-keys",
        "sequences_repaired": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate a GainLog SQLite database to PostgreSQL")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--batch-size", type=int, default=1_000)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    receipt = migrate_database(
        args.source,
        args.target_url,
        batch_size=args.batch_size,
        resume=args.resume,
    )
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
