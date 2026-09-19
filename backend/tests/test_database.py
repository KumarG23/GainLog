from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Field, SQLModel, Session, create_engine

from backend.database import database_bytes, dialect_insert, engine_options


class UpsertProbe(SQLModel, table=True):
    __tablename__ = "test_upsert_probe"

    id: str = Field(primary_key=True)
    value: str


def test_engine_options_are_only_sqlite_specific_for_sqlite_urls():
    assert engine_options("sqlite:////tmp/gainlog.db") == {
        "connect_args": {"check_same_thread": False}
    }
    assert engine_options("postgresql+psycopg://gainlog@localhost/gainlog") == {}


def test_dialect_insert_selects_the_active_backend():
    sqlite_engine = create_engine("sqlite://")
    assert isinstance(dialect_insert(sqlite_engine, UpsertProbe), type(sqlite_insert(UpsertProbe)))

    class PostgreSQLBind:
        dialect = type("Dialect", (), {"name": "postgresql"})()

    assert isinstance(
        dialect_insert(PostgreSQLBind(), UpsertProbe),
        type(postgresql_insert(UpsertProbe)),
    )


def test_database_bytes_uses_sqlite_page_metrics():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[UpsertProbe.__table__])
    with Session(engine) as session:
        assert database_bytes(session) > 0
