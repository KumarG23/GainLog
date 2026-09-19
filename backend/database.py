"""Database engine and SQL dialect helpers shared by GainLog writers."""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlmodel import Session, create_engine


def engine_options(database_url: str) -> dict[str, Any]:
    if make_url(database_url).get_backend_name() == "sqlite":
        return {"connect_args": {"check_same_thread": False}}
    return {}


def create_database_engine(database_url: str) -> Engine:
    return create_engine(database_url, **engine_options(database_url))


def _dialect_name(bind: Any) -> str:
    if isinstance(bind, Session):
        bind = bind.get_bind()
    return bind.dialect.name


def dialect_insert(bind: Any, table_or_model: Any):
    dialect = _dialect_name(bind)
    if dialect == "sqlite":
        return sqlite_insert(table_or_model)
    if dialect == "postgresql":
        return postgresql_insert(table_or_model)
    raise RuntimeError(f"unsupported database dialect: {dialect}")


def database_bytes(session: Session) -> int:
    dialect = _dialect_name(session)
    if dialect == "sqlite":
        page_count = int(session.exec(text("PRAGMA page_count")).one()[0])
        page_size = int(session.exec(text("PRAGMA page_size")).one()[0])
        return page_count * page_size
    if dialect == "postgresql":
        return int(session.exec(text("SELECT pg_database_size(current_database())")).one()[0])
    raise RuntimeError(f"unsupported database dialect: {dialect}")
