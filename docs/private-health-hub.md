# Private Health Hub mirror (Phase 3)

The backend exports authoritative persisted GainLog rows to **one existing private spreadsheet** via the Google Sheets API. It does not create spreadsheets, request Drive scopes, change sharing, read arbitrary Drive files, or delete rows. It does not use the Hermes personal OAuth token or Google Health OAuth credentials. Missing source models are blank rather than fabricated zeroes. The README tab describes source coverage and freshness. Labs is owner-managed and never overwritten except an empty header.

## Provisioning (owner action required)

1. Create a **private** spreadsheet in Neal's Drive named `Health Hub` with these nine tabs, spelled exactly: `Daily`, `Workouts`, `Exercise Sets`, `Meals`, `Benchmarks`, `BP`, `Weekly`, `Labs`, `README`. Leave tabs empty; exporter writes headers. Do not add public or link access.
2. Obtain a dedicated Google Cloud **service-account** JSON key from the owner-approved project with the Sheets API enabled. This key has only `https://www.googleapis.com/auth/spreadsheets` OAuth scope at runtime; it has **no Drive access** and cannot search/create arbitrary Drive files. Ask Neal to authorize sharing **only this sheet** to the exact service-account `client_email` as Editor. Check the sheet's sharing dialog and remove unexpected principals. Never share to an unconfirmed email.
3. Place the JSON at `/etc/gainlog-health-hub/service-account.json`, owned by root, group `gainlog`, mode `0640`, in directory mode `0750` root:gainlog. Store `/etc/gainlog-health-hub.env` root:root `0600`:

   ```text
   GAINLOG_HEALTH_HUB_CREDENTIALS=/etc/gainlog-health-hub/service-account.json
   GAINLOG_HEALTH_HUB_SHEET_ID=<spreadsheet ID from https://docs.google.com/spreadsheets/d/ID/edit>
   ```

   Never put either the key or personal health rows in Git, tests, logs, or chat. The ID alone is not an access grant.
4. Install dependency from `backend/requirements.txt` into `/opt/gainlog/venv-new`, install `gainlog-health-hub.service` and `.timer` under `/etc/systemd/system`, then `systemctl daemon-reload`. For a read-only credential check, run from a root-only shell after `set -a; . /etc/gainlog-health-hub.env; set +a`, change to `/opt/gainlog/backend-git`, and run `/opt/gainlog/venv-new/bin/python -m health_hub --check`. This checks the service account against the exact configured sheet without exposing the key or env values on a command line. An HTTP 403 means the service account is not shared onto the one sheet, Sheets API is disabled, or credentials are invalid; do not swap in personal OAuth.
5. On demand: `sudo systemctl start gainlog-health-hub.service`. Inspect `systemctl status` and journal for `status=synced` and row counts. Verify by reading exact rows from the same private sheet with an owner-authorized Sheets client; README freshness is written only after tab readbacks. Enable `sudo systemctl enable --now gainlog-health-hub.timer` **only after** the on-demand run succeeds. Timer is 03:30 `America/New_York`, including DST changes, and `Persistent=true` catches missed runs. No deployment is automatic with a Git push.

## Schema and semantics

Columns live in `backend/health_hub.py` (`HEADERS`) and are validated before writes. Daily is keyed by Eastern local date; Workouts, Exercise Sets and Meals by source record ID; Benchmarks by workout ID; Weekly by Monday Eastern date. Every run upserts changed rows and leaves historical/unrecognized rows intact. Duplicate existing keys or schema drift stop the job; it never silently remaps a sheet. Sheets `RAW` input prevents formula execution from free-text notes. Source dates with offsets convert to Eastern date and weeks use Monday–Sunday. Data extraction comes from GainLog's existing Apple/Health Connect daily rollup, body-weight, workout/cardio analysis, and nutrition tables; only protocol-compliant, persisted benchmark HR is exported. Existing app model has no BP, CPAP, supplement, meal-tag, or structured weekly-one-change fields yet; these columns are blank and cannot reproduce a **complete** future scorecard. Days-logged is blank until complete-day semantics exist. Daily meal totals represent entries logged, not confirmed full days. No private values belong in the public runbook.

Check status when disabled: `python -m backend.health_hub --check` reports the **missing config**, not a fake healthy sync. For failure recovery, fix credentials/sharing/schema or Google availability, then rerun; deterministic keys and readback make retries safe. Manual Labs rows persist. Do not delete sheet rows to "repair" history. If credentials leak, revoke the key in Google Cloud immediately and rotate the on-host file; do not change broad Google account OAuth grants as a shortcut.
