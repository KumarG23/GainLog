# GainLog PostgreSQL migration and operations

GainLog uses PostgreSQL 16 on the application VM. PostgreSQL is reachable only through its local Unix socket; no TCP listener or database password is required.

## Production architecture

- Cluster data: `/var/lib/gainlog/postgresql/16/main` on the dedicated data disk.
- `listen_addresses = ''`; socket: `/var/run/postgresql`.
- Data checksums enabled.
- OS/database role `gainlog` owns the application database and is used by the API and sync workers through peer authentication.
- OS/database role `gainlog-mcp-source` has `CONNECT`, schema `USAGE`, and column-level `SELECT` only for the fixed projection inputs. Its default transactions are read-only. Executable provisioning and negative permission probes are in `gainlog_mcp/deploy/README.md`.
- Application URL in root-owned `/etc/gainlog.env`:

```dotenv
GAINLOG_DATABASE_URL=postgresql+psycopg:///gainlog?host=/var/run/postgresql
```

- Exporter URL in root-owned `/etc/gainlog-mcp.env`:

```dotenv
GAINLOG_MCP_DATABASE_URL=postgresql+psycopg:///gainlog?host=/var/run/postgresql
```

The MCP exporter reads PostgreSQL inside a repeatable-read, read-only transaction and continues to emit the credential-free allowlisted SQLite projection. It cannot read OAuth tokens or arbitrary application tables through that projection.

## Schema setup

`migrations.schema.apply_schema_migrations()` is the only startup schema entry point. It:

- upgrades legacy SQLite copies before migration;
- materializes historical workout, set, and nutrition ordering that SQLite previously supplied implicitly through row order;
- creates the PostgreSQL schema under an advisory transaction lock;
- records schema version `1` idempotently.

Do not point the PostgreSQL application at an unprepared database or hand-edit tables during a release.

## Rehearsal and source preparation

Never migrate the live SQLite file directly. Make and restore a consistent SQLite `.backup`, preserve the compressed verified backup unchanged, and prepare only the restored working copy:

```bash
GAINLOG_DATABASE_URL=sqlite:////path/to/working-copy.db \
python -c 'from sqlmodel import create_engine; from migrations.schema import apply_schema_migrations; apply_schema_migrations(create_engine("sqlite:////path/to/working-copy.db"))'
```

Create an empty disposable PostgreSQL database owned by `gainlog`, then run:

```bash
python -m migrate_sqlite_to_postgres \
  --source /path/to/working-copy.db \
  --target-url 'postgresql+psycopg:///gainlog_rehearsal?host=/var/run/postgresql' \
  --batch-size 5000
```

The migrator:

- refuses a non-PostgreSQL target;
- requires a valid, complete SQLite source;
- caps each multi-row insert below PostgreSQL's 65,535-parameter protocol limit;
- commits one table at a time and supports explicit conflict-safe `--resume`;
- repairs integer sequences;
- validates every table with row counts and stable ordered row hashes;
- requires all PostgreSQL foreign keys to be validated.

A successful rehearsal must also compare representative API responses against SQLite, exercise a disposable write/read/delete loop, run the Google/V2 focused tests, and generate the MCP projection through its production sandbox.

## Production cutover

1. Confirm a current Proxmox snapshot, full VM backup, and verified application-level SQLite backup.
2. Disable the Google sync timer and wait for active writers to stop.
3. Stop the API and MCP exporter timer.
4. Create and verify the final SQLite backup.
5. Restore that backup to a writable migration working copy; leave the compressed backup immutable.
6. Run `apply_schema_migrations()` against the working SQLite copy.
7. Recreate the empty `gainlog` PostgreSQL database and migrate the working copy.
8. Require the migration receipt to report `status=ok` and `validation=counts-pks-hashes-foreign-keys`.
9. Deploy the exact tested source and unit files, update `/etc/gainlog.env`, and start the API.
10. Run public and local semantic smoke tests before re-enabling sync.
11. Grant the MCP source role read-only access, deploy the exporter, generate and inspect its SQLite projection, then re-enable its timer.
12. Run one Google reconciliation and verify replay/idempotence before restoring its timer.
13. Create and restore-verify a PostgreSQL backup.

Keep the final SQLite backup and pre-cutover deployment until the observation window closes. Rollback means stopping PostgreSQL-backed writers, restoring the previous source/unit/environment, and restarting against the untouched SQLite backup. Never merge independent writes from both engines.

## Backups

Install repository file `gainlog-backup` as `/usr/local/sbin/gainlog-backup` and the matching service/timer. It runs `pg_dump --format=custom` and validates the archive with `pg_restore --exit-on-error`. The `gainlog_mcp` exporter remains independent of backup storage. The script:

- creates a custom-format `pg_dump`;
- restores it into a temporary isolated database with `pg_restore --exit-on-error`;
- exports one repeatable-read snapshot, uses that exact snapshot for `pg_dump`, and verifies every public application-table row count after restore;
- verifies `gainlog_schema_version`;
- writes an atomic archive and SHA-256 sidecar only after restore succeeds;
- retains 14 daily and 30 manual-tier archives.

Manual pre-change backup:

```bash
sudo /usr/local/sbin/gainlog-backup pre-migration
```

A nonzero dump is not a backup victory. The isolated restore is the gate.
