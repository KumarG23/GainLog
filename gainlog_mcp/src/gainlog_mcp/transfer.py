from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import selectors
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO, Iterator

from .exporter import APPLICATION_ID, COPY_TABLES, SCHEMA_VERSION


MAX_STORE_BYTES = 100 * 1024 * 1024
STALE_SECONDS = 15 * 60
FUTURE_SECONDS = 5 * 60
SOURCE_PROJECTION = Path("/var/lib/gainlog-mcp-source/projection.db")
RECEIVED_PROJECTION = Path("/var/lib/gainlog-mcp/projection.db")
SSH_COMMAND = (
    "/usr/bin/ssh",
    "-F",
    "/etc/gainlog-mcp-acquire/ssh_config",
    "-n",
    "-T",
    "gainlog-source",
)

_EXTRA_COLUMNS = {
    "metadata": ("key", "value"),
    "source_connections": (
        "provider", "status", "connected", "last_success_at", "last_attempt_at",
        "last_sync_count", "last_sync_start", "last_sync_end",
    ),
}
EXPECTED_COLUMNS = {
    destination: columns for destination, columns in COPY_TABLES.values()
} | _EXTRA_COLUMNS


class ProjectionError(Exception):
    pass


def _timestamp(value: object) -> datetime:
    if type(value) is not str or not value.endswith("Z"):
        raise ProjectionError("projection metadata is invalid")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise ProjectionError("projection metadata is invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ProjectionError("projection metadata is invalid")
    return parsed


def _validate_database(db: sqlite3.Connection, *, now: datetime) -> datetime:
    if db.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
        raise ProjectionError("projection application id is invalid")
    if db.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
        raise ProjectionError("projection schema version is invalid")
    if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
        raise ProjectionError("projection integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchall():
        raise ProjectionError("projection foreign keys are invalid")

    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    if tables != set(EXPECTED_COLUMNS):
        raise ProjectionError("projection tables are invalid")
    for table, expected in EXPECTED_COLUMNS.items():
        quoted = table.replace('"', '""')
        columns = tuple(row[1] for row in db.execute(f'PRAGMA table_info("{quoted}")'))
        if columns != expected:
            raise ProjectionError("projection columns are invalid")

    metadata_rows = db.execute("SELECT key,value FROM metadata").fetchall()
    metadata = dict(metadata_rows)
    if len(metadata_rows) != 3 or set(metadata) != {
        "schema_version", "exported_at", "source_db_modified_at"
    }:
        raise ProjectionError("projection metadata is invalid")
    if metadata["schema_version"] != str(SCHEMA_VERSION):
        raise ProjectionError("projection metadata is invalid")
    exported_at = _timestamp(metadata["exported_at"])
    _timestamp(metadata["source_db_modified_at"])
    if exported_at > now + timedelta(seconds=FUTURE_SECONDS):
        raise ProjectionError("projection timestamp is in the future")
    if now - exported_at > timedelta(seconds=STALE_SECONDS):
        raise ProjectionError("projection is stale")
    return exported_at


@contextmanager
def open_valid_projection(
    path: Path,
    *,
    now: datetime | None = None,
) -> Iterator[tuple[int, os.stat_result, datetime]]:
    fd: int | None = None
    db: sqlite3.Connection | None = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_STORE_BYTES:
            raise ProjectionError("projection file is invalid")
        db = sqlite3.connect(f"file:/proc/self/fd/{fd}?mode=ro&immutable=1", uri=True)
        db.execute("PRAGMA query_only=ON")
        exported_at = _validate_database(db, now=now or datetime.now(timezone.utc))
        yield fd, info, exported_at
    except ProjectionError:
        raise
    except (FileNotFoundError, OSError, sqlite3.Error):
        raise ProjectionError("projection is unavailable") from None
    finally:
        if db is not None:
            db.close()
        if fd is not None:
            os.close(fd)


def send_projection(
    path: Path = SOURCE_PROJECTION,
    *,
    output: BinaryIO | None = None,
    now: datetime | None = None,
) -> None:
    if os.environ.get("SSH_ORIGINAL_COMMAND"):
        raise ProjectionError("command denied")
    sink = output if output is not None else sys.stdout.buffer
    with open_valid_projection(path, now=now) as (fd, _, _):
        os.lseek(fd, 0, os.SEEK_SET)
        while chunk := os.read(fd, 64 * 1024):
            sink.write(chunk)
        sink.flush()


def _write_from_stream(stream: BinaryIO, target: BinaryIO) -> None:
    total = 0
    while chunk := stream.read(64 * 1024):
        total += len(chunk)
        if total > MAX_STORE_BYTES:
            raise ProjectionError("projection exceeds size limit")
        target.write(chunk)
    if total == 0:
        raise ProjectionError("projection is empty")


def _write_from_process(process: subprocess.Popen[bytes], target: BinaryIO, timeout: float) -> None:
    if process.stdout is None:
        raise ProjectionError("transfer failed")
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout
    total = 0
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProjectionError("transfer timed out")
            if not selector.select(remaining):
                raise ProjectionError("transfer timed out")
            chunk = os.read(process.stdout.fileno(), 64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_STORE_BYTES:
                raise ProjectionError("projection exceeds size limit")
            target.write(chunk)
        if total == 0:
            raise ProjectionError("projection is empty")
        try:
            returncode = process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            raise ProjectionError("transfer timed out") from None
        if returncode != 0:
            raise ProjectionError("transfer failed")
    finally:
        selector.close()


def _install_temporary(temporary: Path, destination: Path, *, now: datetime | None) -> None:
    with open_valid_projection(temporary, now=now):
        pass
    os.chmod(temporary, 0o640)
    with temporary.open("rb") as stream:
        os.fsync(stream.fileno())
    os.replace(temporary, destination)
    directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def install_received_projection(
    stream: BinaryIO,
    destination: Path,
    *,
    now: datetime | None = None,
) -> None:
    destination = Path(destination)
    if destination.is_symlink() or not destination.parent.is_dir():
        raise ProjectionError("destination is invalid")
    fd, name = tempfile.mkstemp(prefix=".gainlog-received-", dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o640)
            _write_from_stream(stream, target)
            target.flush()
            os.fsync(target.fileno())
        _install_temporary(temporary, destination, now=now)
    finally:
        temporary.unlink(missing_ok=True)


def acquire_projection(
    destination: Path = RECEIVED_PROJECTION,
    *,
    command: tuple[str, ...] = SSH_COMMAND,
    timeout: float = 90,
    now: datetime | None = None,
) -> None:
    destination = Path(destination)
    if destination.is_symlink() or not destination.parent.is_dir():
        raise ProjectionError("destination is invalid")
    fd, name = tempfile.mkstemp(prefix=".gainlog-received-", dir=destination.parent)
    temporary = Path(name)
    process: subprocess.Popen[bytes] | None = None
    try:
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o640)
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )
            _write_from_process(process, target, timeout)
            target.flush()
            os.fsync(target.fileno())
        _install_temporary(temporary, destination, now=now)
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        temporary.unlink(missing_ok=True)


def sender_main() -> None:
    try:
        if len(sys.argv) != 1:
            raise ProjectionError("arguments denied")
        send_projection()
    except Exception:
        raise SystemExit(1) from None


def receiver_main() -> None:
    try:
        if len(sys.argv) != 1:
            raise ProjectionError("arguments denied")
        acquire_projection()
    except Exception:
        raise SystemExit(1) from None


def validator_main() -> None:
    try:
        if len(sys.argv) != 1:
            raise ProjectionError("arguments denied")
        with open_valid_projection(RECEIVED_PROJECTION):
            pass
    except Exception:
        raise SystemExit(1) from None
