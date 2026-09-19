from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
@pytest.mark.parametrize(
    "unit_name",
    ["gainlog.service", "gainlog-google-health-sync.service"],
)
def test_production_units_pin_the_same_database_url(unit_name: str) -> None:
    unit = (BACKEND_DIR / unit_name).read_text()

    assert "EnvironmentFile=/etc/gainlog.env" in unit
    assert "GAINLOG_DATABASE_URL=sqlite" not in unit


def test_api_unit_accepts_traffic_only_from_the_local_tailnet_proxy() -> None:
    unit = (BACKEND_DIR / "gainlog.service").read_text()

    assert (
        "uvicorn main:app --host 127.0.0.1 --port 8000 --no-access-log"
        in unit
    )


def test_api_unit_limits_write_access_and_process_privileges() -> None:
    unit = (BACKEND_DIR / "gainlog.service").read_text()

    for directive in (
        "UMask=0077",
        "NoNewPrivileges=true",
        "PrivateTmp=true",
        "ProtectHome=true",
        "ProtectSystem=strict",
        "ReadWritePaths=/opt/gainlog/backend-git/data",
    ):
        assert directive in unit


def test_documented_deployment_never_copies_the_mutable_database() -> None:
    setup = (BACKEND_DIR / "SETUP.md").read_text()

    assert "cp -r backend/*" not in setup
    assert "--exclude='data/'" in setup


def test_postgresql_runbook_covers_private_roles_migration_and_restore_verification() -> None:
    runbook = (BACKEND_DIR / "POSTGRESQL.md").read_text()

    for required in (
        "listen_addresses = ''",
        "GAINLOG_DATABASE_URL=postgresql+psycopg://",
        "migrate_sqlite_to_postgres",
        "pg_dump --format=custom",
        "pg_restore",
        "gainlog_mcp",
        "SELECT",
    ):
        assert required in runbook


def test_postgresql_backup_is_atomic_and_restore_verified() -> None:
    script = (BACKEND_DIR / "gainlog-backup").read_text()
    service = (BACKEND_DIR / "gainlog-backup.service").read_text()

    for required in (
        "pg_dump",
        "--format=custom",
        "pg_restore",
        "--exit-on-error",
        "gainlog_schema_version",
        "sha256sum",
        "flock",
    ):
        assert required in script
    assert "gainlog.db" not in script
    assert "User=root" in service
    assert "After=postgresql.service" in service
    assert "ExecStart=/usr/local/sbin/gainlog-backup daily" in service
