# GainLog V2 health-data foundation

Phase 1 preserves Google Health data beside the legacy daily-health pipeline. It does not feed existing endpoints, MCP output, dashboard calculations, or canonical steps.

## Runtime

- Legacy sync remains authoritative.
- Set `GAINLOG_GOOGLE_HEALTH_V2_SHADOW=1` to run V2 after a successful legacy sync.
- A V2 failure is recorded in `health_v2_import_run` and logged without provider payloads or credentials. It does not roll back or fail the completed legacy sync.
- Run a bounded import explicitly with:

  ```bash
  python -m backend.google_health_v2_sync --complete-days 14 --json
  ```

  The default window ends at the current Eastern local date, so it contains complete days only.

- Create only the additive V2 tables with:

  ```bash
  python -m backend.migrations.health_v2_foundation
  ```

## Layered model

- `health_v2_source`: provider, platform, application, device, recording method, and first/last observed timestamps.
- `health_v2_import_run`: requested window, completion/failure state, page/call/row counts, bounded-page high-water mark, token hash diagnostics, runtime, RSS high-water mark, and database size.
- `health_v2_sample`: HR, sample HRV, SpO2, and sleep respiratory observations.
- `health_v2_minute_summary`: durable one-minute HR aggregates built from preserved samples.
- `health_v2_interval`: source-raw activity/movement intervals plus separately named Google reconciled step intervals.
- `health_v2_sleep_session`, `health_v2_sleep_stage`, `health_v2_sleep_event`: reconstructable sleep timelines; naps remain distinct sessions.
- `health_v2_exercise_session`: Google exercise sessions remain separate from GainLog-native workouts.
- `health_v2_daily_metric`: daily provider metrics and metric-level step provenance.
- `health_v2_data_quality`: internal presence, coverage, partial-day, and source-conflict observations. These are not score thresholds.

Stable IDs and payload hashes make overlapping windows idempotent and allow provider corrections to update records without duplication. After an endpoint finishes every page successfully, rows in that endpoint/window that were not seen are tombstoned; failed or partial endpoints never run that sweep. Explicit provider deletion events can use the same `is_deleted` fields later. Failed page-streamed runs can be retried from the requested window; already committed pages become unchanged rows.

## Streaming boundaries

Each Google endpoint uses pages of at most 1,000 provider points. A page is normalized and committed before requesting the next page. No endpoint accumulates its entire history in memory. Sleep child rows are bounded by their containing page/session. Derived minute rows are aggregated one day at a time, and quality rows use bounded daily database aggregates.

## Retention target

Retention deletion is intentionally not enabled during initial validation. The schema separates raw and derived records so later jobs can enforce:

- full-resolution HR: 90 days
- one-minute HR summaries: long-term
- sleep sessions/stages/events: indefinite
- raw HRV: at least one year
- raw SpO2, respiratory, and high-frequency activity: 90 days
- source-specific steps: 12 months
- daily metrics, provenance, and import diagnostics: indefinite

## Phase 1 data types

- Samples: heart rate, HRV RMSSD/SDNN, oxygen saturation, respiratory-rate sleep summaries.
- Intervals: steps, heart-rate-zone time, activity level, active minutes, Active Zone Minutes, sedentary periods.
- Sleep: raw-source and Google-wearables reconciled sessions, stages, short awakenings, and out-of-bed segments.
- Exercise: raw-source and Google-wearables reconciled sessions.
- Daily: resting HR, HRV components, oxygen saturation components, respiratory rate, sleep-temperature derivations, and HR-zone bounds.
- Steps: source-raw intervals/totals, Google-wearables reconciled intervals/totals, Google all-source reconciled intervals/totals, and the unchanged current GainLog canonical total.

Distance, active energy, and total calories continue through the existing authoritative daily pipeline in Phase 1.
