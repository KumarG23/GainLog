from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import shutil
import sqlite3
import sys

import pytest

from conftest import digest


NOW = datetime(2026, 9, 8, 16, 5, tzinfo=timezone.utc)


def test_received_projection_is_structurally_validated_and_atomically_replaced(
    projection: Path,
    tmp_path: Path,
):
    from gainlog_mcp.transfer import install_received_projection, open_valid_projection

    destination_dir = tmp_path / "received"
    destination_dir.mkdir()
    destination = destination_dir / "projection.db"
    destination.write_bytes(b"previous-complete-snapshot")
    install_received_projection(BytesIO(projection.read_bytes()), destination, now=NOW)

    assert digest(destination) == digest(projection)
    assert destination.stat().st_mode & 0o777 == 0o640
    with open_valid_projection(destination, now=NOW) as (_, info, exported_at):
        assert info.st_size == destination.stat().st_size
        assert exported_at.isoformat() == "2026-09-08T16:00:00+00:00"


def test_partial_invalid_and_stale_receipts_preserve_previous_snapshot(
    source_db: Path,
    projection: Path,
    tmp_path: Path,
):
    from gainlog_mcp.exporter import export_projection
    from gainlog_mcp.transfer import ProjectionError, install_received_projection

    destination_dir = tmp_path / "received"
    destination_dir.mkdir()
    destination = destination_dir / "projection.db"
    destination.write_bytes(b"previous-complete-snapshot")
    before = destination.read_bytes()

    with pytest.raises(ProjectionError):
        install_received_projection(BytesIO(projection.read_bytes()[:4096]), destination, now=NOW)
    assert destination.read_bytes() == before

    tampered = tmp_path / "tampered.db"
    shutil.copyfile(projection, tampered)
    db = sqlite3.connect(tampered)
    db.execute("CREATE TABLE unexpected_payload (value TEXT)")
    db.commit()
    db.close()
    with pytest.raises(ProjectionError, match="tables"):
        install_received_projection(BytesIO(tampered.read_bytes()), destination, now=NOW)
    assert destination.read_bytes() == before

    stale = tmp_path / "stale.db"
    export_projection(source_db, stale, exported_at="2026-09-08T15:49:59Z")
    with pytest.raises(ProjectionError, match="stale"):
        install_received_projection(BytesIO(stale.read_bytes()), destination, now=NOW)
    assert destination.read_bytes() == before


def test_failed_ssh_transfer_never_replaces_snapshot(projection: Path, tmp_path: Path):
    from gainlog_mcp.transfer import ProjectionError, acquire_projection

    destination_dir = tmp_path / "received"
    destination_dir.mkdir()
    destination = destination_dir / "projection.db"
    destination.write_bytes(b"previous-complete-snapshot")
    command = (
        sys.executable,
        "-c",
        "import pathlib,sys;sys.stdout.buffer.write(pathlib.Path(sys.argv[1]).read_bytes());sys.exit(23)",
        str(projection),
    )

    with pytest.raises(ProjectionError, match="transfer failed"):
        acquire_projection(destination, command=command, now=NOW)
    assert destination.read_bytes() == b"previous-complete-snapshot"
    assert not list(tmp_path.glob(".gainlog-received-*"))


def test_sender_rejects_remote_commands_and_streams_same_valid_file(
    projection: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    from gainlog_mcp.transfer import ProjectionError, send_projection

    output = BytesIO()
    monkeypatch.delenv("SSH_ORIGINAL_COMMAND", raising=False)
    send_projection(projection, output=output, now=NOW)
    assert output.getvalue() == projection.read_bytes()

    monkeypatch.setenv("SSH_ORIGINAL_COMMAND", "cat /etc/passwd")
    with pytest.raises(ProjectionError, match="command denied"):
        send_projection(projection, output=BytesIO(), now=NOW)


def test_runtime_transport_has_fixed_paths_host_and_no_caller_controls():
    from gainlog_mcp.transfer import RECEIVED_PROJECTION, SOURCE_PROJECTION, SSH_COMMAND

    assert SOURCE_PROJECTION == Path("/var/lib/gainlog-mcp-source/projection.db")
    assert RECEIVED_PROJECTION == Path("/var/lib/gainlog-mcp/projection.db")
    assert SSH_COMMAND == (
        "/usr/bin/ssh",
        "-F",
        "/etc/gainlog-mcp-acquire/ssh_config",
        "-n",
        "-T",
        "gainlog-source",
    )
