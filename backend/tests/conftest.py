import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path("/tmp/gainlog-test.db")
os.environ["GAINLOG_DATABASE_URL"] = f"sqlite:///{TEST_DB}"


@pytest.fixture
def client():
    from backend.main import app, engine

    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
