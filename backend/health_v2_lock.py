"""Cross-entry-point PostgreSQL exclusion for GainLog V2 writers."""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
from typing import Any, Callable, Iterator, TypeVar

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

_HEALTH_V2_WRITER_LOCK_KEY = 1196183368
_F = TypeVar("_F", bound=Callable[..., Any])


def _engine(target: Any) -> Engine:
    bind = target.get_bind() if hasattr(target, "get_bind") else target
    if isinstance(bind, Connection):
        return bind.engine
    if isinstance(bind, Engine):
        return bind
    raise TypeError("health V2 writer lock requires a Session, Connection, or Engine")


@contextmanager
def health_v2_writer_lock(target: Any) -> Iterator[None]:
    """Hold one session-level PostgreSQL lock across every incremental commit."""
    engine = _engine(target)
    if engine.dialect.name != "postgresql":
        yield
        return
    with engine.connect() as connection:
        connection.execute(
            text("SELECT pg_advisory_lock(:key)"),
            {"key": _HEALTH_V2_WRITER_LOCK_KEY},
        )
        connection.commit()
        try:
            yield
        finally:
            connection.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": _HEALTH_V2_WRITER_LOCK_KEY},
            )
            connection.commit()


def health_v2_writer_locked(function: _F) -> _F:
    @wraps(function)
    def wrapped(target: Any, *args: Any, **kwargs: Any):
        with health_v2_writer_lock(target):
            return function(target, *args, **kwargs)

    wrapped._health_v2_writer_locked = True  # type: ignore[attr-defined]
    return wrapped  # type: ignore[return-value]
