from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from conftest import CANARY, digest


def test_export_is_allowlisted_atomic_and_does_not_modify_source(source_db: Path, tmp_path: Path):
    from gainlog_mcp.exporter import export_projection

    before = (digest(source_db), source_db.stat().st_size, source_db.stat().st_mtime_ns)
    destination = tmp_path / "reader.db"
    summary = export_projection(
        source_db,
        destination,
        exported_at="2026-09-08T16:00:00Z",
    )
    after = (digest(source_db), source_db.stat().st_size, source_db.stat().st_mtime_ns)

    assert before == after
    assert summary["schema_version"] == 1
    assert summary["table_counts"]["workout_sessions"] == 1
    assert destination.stat().st_mode & 0o777 == 0o640
    assert CANARY.encode() not in destination.read_bytes()

    db = sqlite3.connect(f"file:{destination}?mode=ro", uri=True)
    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    }
    assert "google_health_connection" not in tables
    assert "google_health_oauth_state" not in tables
    assert "nutrition_sync_event" not in tables
    assert tables == {
        "metadata", "workout_sessions", "exercises", "workout_sets",
        "body_composition", "daily_health", "google_daily_snapshots",
        "health_connect_ownership", "goals", "nutrition_entries",
        "daily_reviews", "weekly_reviews", "trend_summaries", "source_connections",
    }
    status = db.execute(
        "SELECT provider, status, connected, last_sync_count FROM source_connections"
    ).fetchone()
    assert status == ("google-health", "connected", 1, 1)
    db.close()


def test_export_rejects_symlink_destination_and_missing_schema(source_db: Path, tmp_path: Path):
    from gainlog_mcp.exporter import ExportError, export_projection

    real = tmp_path / "real.db"
    real.touch()
    link = tmp_path / "link.db"
    link.symlink_to(real)
    with pytest.raises(ExportError, match="destination"):
        export_projection(source_db, link)

    broken = tmp_path / "broken.db"
    sqlite3.connect(broken).execute("CREATE TABLE workout_session (id TEXT)").connection.close()
    with pytest.raises(ExportError, match="schema"):
        export_projection(broken, tmp_path / "unused.db")


def test_preflight_reports_only_structure_and_counts(source_db: Path):
    from gainlog_mcp.exporter import preflight

    result = preflight(source_db)
    assert result["compatible"] is True
    assert result["table_count"] == 15
    assert result["row_counts"]["apple_health_daily"] == 1
    rendered = str(result)
    assert CANARY not in rendered
    assert "encrypted_refresh_token" not in rendered
    assert "code_verifier" not in rendered
