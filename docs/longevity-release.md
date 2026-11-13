# Longevity release 1.1.30

## Implemented

- Manual paired blood pressure, session-weighted averages, on-demand Android Health Connect BP import/write, and source-aware deduplication.
- CPAP nightly entry/correction with calendar-denominator adherence and explicit observed-night coverage. Missing AHI is not zero.
- Configurable AM/PM supplements and daily checklist; no personal regimen is embedded in source.
- Owner-confirmed meal tags and full-day logging confirmation. Food rows in a single date/meal are counted as one meal, not multiple dinners.
- Monday–Sunday Eastern scorecard with live values, evidence coverage, missing-data amber status, a single explicitly rule-based suggested next step, and saved snapshots alongside existing weekly reviews. Existing review prose is preserved. Nutrition averages require confirmed full-day logs; averages exclude today.
- Optional local BP reminders on Tuesday/Saturday at 08:00 Eastern. The next 14 days refresh when the Longevity screen is opened. Requires Android notification permission; physical delivery/tap validation is separate from build verification.
- One-way private Sheets mirror code and 03:30 Eastern systemd timer. **Not live until a dedicated service account, exact private sheet ID, approved sharing and a verified first run exist.** Personal OAuth is not installed into the backend.

## Prior 1.1.29 milestone

Timed sets, Wednesday interval/readiness guidance, editable zone bands, sample-derived cardio analytics, explicit segment timestamps, protocol-gated manual benchmark and Trends chart. Inferred or insufficiently covered HR windows cannot become benchmark/coach fitness evidence. Target HR zones remain estimates, not measured physiological thresholds.

## Remaining acceptance / limitations

- Phone install, Health Connect permission/import/write behavior, notification delivery/tap routing, and real recorded cardio timing require physical-device verification.
- The private sheet must complete a real export and another authorized reader must reproduce the scorecard. Code/tests are not live sync evidence.
- Supplements are configurable but must be populated privately from the owner's confirmed regimen.
- A manual Benchmark action is available; automatic first-Monday insertion is not implemented.
- CPAP's manual fast path is available; PDF therapy-summary import is not implemented.
- Scorecard suggestion is deterministic/rule-based, not a new LLM-generated coach response. Thresholds describe tracking targets, not diagnosis or treatment changes.
- Remote timed carries/hangs/balance are not activated until the compatible Android build is confirmed installed; old clients must not receive seconds prescriptions prematurely.

## Recovery and validation

Use an additive schema upgrade with a restore-tested database dump and a deployed source rollback copy. Preserve service configuration and runtime credentials. Build Android with explicit production HTTPS API origin, V2 shell and remote-plan flags; preserve signing lineage and install in place, never uninstall to update. A Git push alone deploys nothing.
