import os
import threading
import time

import pytest
from sqlmodel import create_engine


def test_all_destructive_v2_paths_use_shared_database_lock():
    from backend.google_health_v2 import sync_google_health_v2
    from backend.health_v2_retention import run_retention

    assert sync_google_health_v2._health_v2_writer_locked is True
    assert run_retention._health_v2_writer_locked is True


@pytest.mark.skipif(
    not os.environ.get("GAINLOG_TEST_POSTGRES_URL"),
    reason="disposable PostgreSQL is not configured",
)
def test_postgresql_writer_lock_survives_other_connection_commits():
    from backend.health_v2_lock import health_v2_writer_lock

    engine = create_engine(os.environ["GAINLOG_TEST_POSTGRES_URL"])
    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()

    def first_writer():
        with health_v2_writer_lock(engine):
            first_entered.set()
            assert release_first.wait(timeout=5)

    def second_writer():
        assert first_entered.wait(timeout=5)
        with health_v2_writer_lock(engine):
            second_entered.set()

    first = threading.Thread(target=first_writer)
    second = threading.Thread(target=second_writer)
    first.start()
    second.start()
    assert first_entered.wait(timeout=5)
    time.sleep(0.2)
    assert not second_entered.is_set()
    release_first.set()
    first.join(timeout=5)
    second.join(timeout=5)
    assert not first.is_alive()
    assert not second.is_alive()
    assert second_entered.is_set()
