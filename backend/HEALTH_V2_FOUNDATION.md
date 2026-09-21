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

## Retention policy

`python -m backend.health_v2_retention --json` performs a dry run by default. `--apply` is the only write path. Cutoffs use complete Eastern civil days, deletion commits in bounded batches, and unknown sample or interval types are reported and retained. The weekly systemd unit is deliberately installed without `--apply` until a production dry-run receipt is accepted.

The policy enforces:

- full-resolution HR: 90 days
- one-minute HR summaries: long-term
- sleep sessions/stages/events: indefinite
- raw HRV: at least one year
- raw SpO2, respiratory, and high-frequency activity: 90 days
- source-specific steps: 12 months
- daily metrics, provenance, and import diagnostics: indefinite

Full-resolution heart-rate samples are eligible only when a matching long-term minute summary exists for the same local date, source, provenance, and UTC minute. Retention never runs `VACUUM`; PostgreSQL reuses dead space through normal maintenance. Retention and every V2 writer—including API-triggered sync, timers, direct CLI imports, and backfill chunks—hold the same PostgreSQL session-level advisory lock on a dedicated connection across incremental commits.

## Historical backfill

Run complete-day history in deterministic oldest-first chunks:

```bash
python -m backend.google_health_v2_backfill \
  --start 2026-06-20 --end 2026-09-18 \
  --chunk-days 7 --max-chunks 1 --json
```

`--end` is exclusive. Exact successful windows in `health_v2_import_run` are skipped unless `--replay` is supplied. `--max-chunks` limits provider executions rather than completed-window checks, so a canary cannot stall on an already-complete first chunk. A failed chunk stops later work; rerunning resumes by skipping exact successful chunks. Receipts contain aggregate chunk, record, API/page, runtime, peak-memory, and database-growth diagnostics only.

## Phase 1 data types

- Samples: heart rate, HRV RMSSD/SDNN, oxygen saturation, respiratory-rate sleep summaries.
- Intervals: steps, heart-rate-zone time, activity level, active minutes, Active Zone Minutes, sedentary periods.
- Sleep: raw-source and Google-wearables reconciled sessions, stages, short awakenings, and out-of-bed segments.
- Exercise: raw-source and Google-wearables reconciled sessions.
- Daily: resting HR, HRV components, oxygen saturation components, respiratory rate, sleep-temperature derivations, and HR-zone bounds.
- Steps: source-raw intervals/totals, Google-wearables reconciled intervals/totals, Google all-source reconciled intervals/totals, and the unchanged current GainLog canonical total.

Distance, active energy, and total calories continue through the existing authoritative daily pipeline in Phase 1.

## Experimental shadow models

`health_v2_sleep_model.py` is the first read-only Phase 2 evaluator. Version `0.1-experimental` does not write tables, alter APIs, feed coaching, or drive UI state.

The sleep evaluator:

- chooses one `MAIN_SLEEP` session per local end date, preferring `google_wearables_reconciled` over duplicate `source_raw` sessions;
- scores duration at 60% and sleep efficiency at 25% when a valid sleep-period denominator exists;
- adds 15% midpoint consistency only after seven prior complete days, using circular midnight-aware distance over at most 28 trailing days;
- renormalizes over available components instead of treating missing optional inputs as bad physiology;
- returns unavailable rather than a low score when sleep is absent;
- caps confidence at 0.5 for a partial-day quality row;
- emits aggregate-only CLI receipts so routine evaluation does not log day-level health details.

Production aggregate evaluation for 2026-08-21 through 2026-09-21 found 32 available days, zero unavailable days, a score range of 27–100, and a median of 88.5. This is calibration evidence only, not validation or authorization to expose the score. Sleep-stage percentages are deliberately excluded from v0.1 scoring because consumer stage estimates are too noisy to deserve score weight without stronger evidence.

`health_v2_recovery_model.py` is the second read-only Phase 2 evaluator. Version `0.1-experimental` composes the shadow Sleep result with daily HRV RMSSD and resting heart rate without writing or serving the result.

The Recovery evaluator:

- weights Sleep at 40%, HRV at 35%, and resting heart rate at 25%, then renormalizes over available components;
- scores HRV and resting heart rate only after 14 prior complete observations, using the median of at most 28 trailing days and never including the target day in its own baseline;
- anchors a personal-baseline biomarker day at 70, with higher HRV and lower resting heart rate improving the component score, and clamps each component to 0–100;
- carries Sleep's source confidence into Recovery confidence and does not convert unavailable biomarkers into penalties;
- returns unavailable only when no component can be scored and caps confidence at 0.5 for partial-day data;
- emits aggregate-only CLI receipts and remains disconnected from APIs, coaching, persistence, and UI.

Production aggregate evaluation over the same 32-day window found 32 available days, a score range of 52–100, and a median of 81.5: 18 high, 12 moderate, and 2 low days. All 32 days had Sleep; the trailing-baseline gate admitted HRV on 18 days and resting heart rate on 19. Median confidence was 1.0, with early Sleep-only days as low as 0.34. Component medians were 88.5 for Sleep, 75.5 for HRV, and 77 for resting heart rate. These results are calibration evidence only; longitudinal face-validity review is still required before exposure.

`health_v2_load_model.py` is the third read-only Phase 2 evaluator. Version `0.1-experimental` derives training load from reconciled exercise duration and only the raw heart-rate-zone intervals that overlap those sessions.

The Load evaluator:

- gives every exercise minute one base load point, then adds one point per moderate minute, two per vigorous minute, and three per peak minute;
- treats uncovered exercise time as base load rather than a penalty and scales overlapping zone totals down to session duration so duplicate/overlapping telemetry cannot inflate load;
- distinguishes a supported rest day from unavailable data by requiring a heart-rate quality observation when no exercise session exists;
- reports confidence from exercise-session availability plus zone coverage, capped at 0.5 for partial days;
- compares active days with the median of at least seven active days inside the prior 28 calendar days, labeling the result low below 0.75×, typical from 0.75–1.25×, and high above 1.25×;
- emits aggregate-only receipts and remains disconnected from APIs, coaching, persistence, and UI.

Production aggregate evaluation for 2026-08-21 through 2026-09-21 found all 32 days available: 24 active and 8 supported rest days. Daily load ranged from 0–380 with a median of 133; active-day load ranged from 38–380 with a median of 145. After the baseline gate, states were 5 low, 8 typical, and 4 high, while 7 early active days remained observed-only. Heart-rate-zone coverage on active days ranged from 0.89–1.0 with a median of 1.0; confidence ranged from 0.5–1.0 with a median of 1.0. The broader 94-day window correctly left 61 days unavailable because retained exercise/heart-rate evidence existed for only 33 days. This is calibration evidence only, not authorization to expose or coach from the model.

`health_v2_stress_model.py` completes the first read-only Phase 2 model sequence. Version `0.1-experimental` is a retrospective physiological-activation timeline, not a psychological-stress detector, medical claim, or WHOOP-equivalent feature.

The Stress evaluator:

- chooses one heart-rate source and one activity-context source per local day by greatest minute coverage, preventing overlapping Pixel Watch and Fitbit Air telemetry from being blended;
- emits an explicit DST-aware `America/New_York` minute timeline and keeps unobserved telemetry distinct from low stress;
- overlays reconciled main sleep and exercise, excludes active movement from stress scoring, and scores only minutes with both heart rate and sedentary context;
- does not infer non-wear from a gap: absent telemetry remains `unobserved`, while observed heart rate without activity context remains `context_unavailable`;
- requires at least seven prior qualifying days inside 14 calendar days, at least 30 sedentary minutes per qualifying day, and at least 300 total baseline minutes;
- reports each scored minute as its midrank percentile against the personal sedentary-heart-rate baseline, provisionally labeling below the 50th percentile low, the 50th–84th moderate, and the 85th percentile or higher high;
- derives confidence from heart-rate sample density, caps partial-day confidence at 0.5, and preserves known sleep/exercise/activity context even when heart rate is absent;
- emits aggregate-only CLI receipts and can discard detailed timelines during aggregate evaluation to keep historical profiling bounded.

Production aggregate evaluation for 2026-08-21 through 2026-09-21 covered 46,080 local minutes and observed heart rate in 41,033 (89.0%). It scored 11,359 sedentary/context-qualified minutes (24.7% of the full timeline): 5,624 low (49.5%), 3,909 moderate (34.4%), and 1,826 high (16.1%), closely matching the intended personal-percentile calibration rather than manufacturing a population norm. The timeline also retained 14,846 sleep, 1,579 exercise, 4,763 activity, 5,905 context-unavailable, 2,654 baseline-unavailable, and 4,974 unobserved minutes. The baseline was ready on 26 of 32 days; scored-minute confidence had a median of 1.0 and only 10 minutes below 0.5. Aggregate execution completed in about five seconds with approximately 274 MiB peak RSS under a 1 GiB cap. A 94-day run completed with the same bounded memory and left 93,978 minutes unobserved where retained telemetry did not exist. These are calibration and feasibility results only; longitudinal face-validity review remains required before any API, coaching, or UI exposure.
