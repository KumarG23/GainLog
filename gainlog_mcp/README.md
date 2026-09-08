GainLog read-only MCP

This self-contained Python subproject exports a credential-free allowlisted SQLite projection from GainLog and serves it through eight read-only MCP tools. It does not import the GainLog backend, call its HTTP routes, invoke AI, synchronize providers, perform OAuth, or write to the application database.

Tools

- get_data_coverage: record/date coverage, projection freshness, source status/semantics, and omissions.
- list_workouts: bounded session history with strength/cardio summaries and exercise/set counts.
- get_workout: exact or latest session with exercises and every persisted set.
- query_nutrition: exact entry or bounded detailed nutrition history.
- query_body_composition: exact entry or bounded weight/body-composition history.
- query_daily_health: exact day or bounded canonical/Google-snapshot sleep, activity, HRV, and resting-heart-rate history.
- query_goals: exact goal or status-filtered goals.
- query_saved_reviews: existing daily, weekly, or trend outputs only.

All list ranges are limited to 366 inclusive calendar dates, pages to 50 records, and offsets to 10,000. The final accessible page explicitly reports truncation and tells callers to narrow the date range or filter when additional records exist beyond that ceiling; it never presents a clipped history as complete. Unknown fields, invalid types, oversized protocol frames, malformed discovery probes, arbitrary paths/URLs/SQL-shaped controls, and unknown tools fail closed without reflecting input. Missing values remain JSON null; observed zeros remain zero.

Development

    uv sync --extra test
    uv run pytest -q
    uv build --wheel

The official mcp==1.26.0 SDK is pinned in uv.lock. Subprocess tests perform initialize, tools/list, every tool call, malformed-input denial, and the modern server/discover -32601 fallback before and after legacy initialization.

Exporter

    uv run gainlog-mcp-export --preflight --source /absolute/path/to/gainlog.db
    uv run gainlog-mcp-export --source /absolute/path/to/gainlog.db --destination /absolute/path/to/projection.db

Preflight emits only table counts and compatibility metadata. Normal export emits no health payload. The source is opened mode=ro with query_only, the destination is built from fixed table/column allowlists, integrity-checked, fsynced, chmod 0640, and atomically replaced.

Split transfer

The source-side forced command streams only `/var/lib/gainlog-mcp-source/projection.db` and rejects arguments or `SSH_ORIGINAL_COMMAND`. The Hermes acquisition process has no IP network and reaches a credential-free fixed-destination SSH proxy over one Unix socket. Before replacing `/var/lib/gainlog-mcp/projection.db`, it validates successful transfer, bounded size, exact SQLite application/schema/table/column structure, integrity, timestamps, and freshness. Failed, partial, malformed, future, or stale transfers preserve the prior complete snapshot.

Deployment

See deploy/README.md. Only the credential-free exporter and fixed-command projection sender run beside GainLog in LXC 106. Acquisition, the networkless reader, the OpenAI tunnel, and the received projection live independently on Hermes. Acquisition and tunnel credentials use different identities and `LoadCredential`; neither the reader nor tunnel can read the source or acquisition key. Production installation, source-permission hardening, SSH-key enrollment, runtime-key enrollment, service activation, and ChatGPT app creation are deliberately not performed by this build. The existing tunnel ID is reused; no new tunnel is created.
