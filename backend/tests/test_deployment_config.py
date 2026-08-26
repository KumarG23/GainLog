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
