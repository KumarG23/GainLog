from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
EXPECTED_DATABASE_ENV = (
    'Environment="GAINLOG_DATABASE_URL=sqlite:////opt/gainlog/backend-git/data/gainlog.db"'
)


@pytest.mark.parametrize(
    "unit_name",
    ["gainlog.service", "gainlog-google-health-sync.service"],
)
def test_production_units_pin_the_same_database_url(unit_name: str) -> None:
    unit = (BACKEND_DIR / unit_name).read_text()

    assert EXPECTED_DATABASE_ENV in unit


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
