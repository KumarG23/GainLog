# GainLog V2 — Connected day / Build Your Healthspan

## Authoritative delivery branch

Continue **`feat/healthspan-v2-shell` / PR #3**, based on Jarvis's working
`056325b7df9b1c0cedb23f25ff90a4b2d95353e8` (1.1.19, code 36) plus the CI checkpoint
`7096407`. Do not switch to the older parallel PR #4 branch. The declarative cold
start, dedicated `/workout` route, increased tab height, identifiers and signing
lineage are preserved. The global Quick Log workout shortcut now also uses
`/workout` in the full shell. Main is not merged or deployed by this work.

## What changed beyond the visual shell

Today now leads with a deterministic **connected daily brief**. It consumes the
current local day, available recovery/sleep, recorded sessions, food entries,
a lightweight self-reported check-in and the existing weekday template. It has
morning, daytime, after-training and evening states. A high recovery estimate
cannot dismiss reported low energy or soreness. A logged workout is acknowledged
rather than turning into another workout prompt. Missing/stale inputs suppress
unsupported conclusions; food log gaps do not become instructions to eat.

The check-in captures optional energy, soreness, perceived stress (1–5), training
intention, and a note. There is one editable entry per calendar day, with an
optional stress-timeline minute link and an evening reflection. The note and its
minute link are a single daily context note, not a multi-event journal.

Sleep planning saves a user-chosen wake time, time-in-bed opportunity and wind-down
lead time. No inferred sleep need, automatic alarm, notification or goal changes.
A weekly focus is a preference, not a new health goal or score.

Health is now a completed-week foundation review: sleep, strength, everyday
movement, nutrition logging, and reported stress. Behaviors/logs are separated
from observations. Missing points stay gaps. Weight direction and saved evening
reflections are available alongside the week. This is a descriptive review, not
causal analysis, biological age, or an automatic longitudinal coaching engine.

Fuel now shows saved protein/fiber target ranges and a deliberate log-review
confirmation. Its non-security change fingerprint invalidates the confirmation
when entries, macros, dates or notes change, including deletion. Confirmation
means only that the user reviewed the log, not independent proof of full intake.

Recovery and load have deliberately composed explanations. Sleep has a new
read-only endpoint for a single preferred main session, actual stage intervals,
and prior-night history. The selection mirrors the existing sleep evaluator;
no stages from another source are spliced in. Overlap/invalid timing is withheld.
The stress timeline supports selection/scrubbing and accessible period controls;
context notes are self-report, never inferred causes of activation.

## Backend change — this is NOT an APK-only release

`backend/journey.py` adds two tables through the existing SQLModel schema startup:
`journey_day` and `journey_preferences`. Existing tables, scoring formulas,
ingestion, OAuth, MCP and stored goals are unchanged. No private records are
bundled in this commit or its tests.

The module is registered at the end of `backend/main.py`, before application
lifespan runs. There is no new Python dependency. Existing SQLite/Postgres schema
setup creates the two additive tables; it does not drop or replace old tables.

New routes (existing private, single-user API boundary; no new auth model):

- `GET /journey?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — bounded to 35 days.
- `PATCH /journey/days/{date}` — explicit partial save with `expectedRevision`.
- `DELETE /journey/days/{date}?expectedRevision=N` — erases values and notes,
  retaining only a monotonically increasing revision tombstone.
- `PATCH /journey/preferences` — revision-checked sleep/focus preferences.
- `GET /journey/sleep/{date}` — read-only selected main night/stages/history.

Writes use compare-and-swap revisions; stale clients get 409. No blind retry or
queued write. A lost save confirmation blocks another save until refresh. A 404
from an older backend is shown as an upgrade-needed state, while other app records
remain available. Check-ins are not put into local unencrypted persistence,
provider writes, public logs, or AI prompts. API responses have `no-store`.

The physiology pipeline still uses America/New_York. Check-ins use the device's
local calendar day and pass a validated IANA time zone. Plans are local wall-clock
windows, not elapsed-duration promises across DST. Multi-timezone physiology is
not newly solved here.

## Validation and real-device acceptance

The local configured frontend test suite passes with native TypeScript stripping;
28 new behavioral tests cover the daily brief, stale/missing inputs, source/day
boundaries, duplicate/future records, reviewed-log change detection, midnight
planning, and saved ranges. Syntax checks are not a replacement for the complete
CI TypeScript/lint/exports. See the latest PR checkpoint/run for exact CI results.

Backend tests use only isolated `/tmp` databases and synthetic fixtures. They
cover defaults, additive schema startup, partial saves, revision conflicts,
erasure, validation, restricted windows, unchanged existing domains, and actual
sleep timeline selection/gaps/overlap withholding. Do NOT point tests at a real
SQLite file, live Postgres database, or health provider.

A native signed APK and physical-device acceptance remain Jarvis's responsibility.
Do not interpret web/Android JavaScript exports as a signed or installed APK.

## Jarvis rollout

1. Preserve all local work. Fetch this branch into the existing review worktree or
   a clean worktree. Record the actual HEAD; do not reset to an old SHA in this doc.
2. Run `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run lint`, and
   `python -m pytest backend/tests -q` with the tests' isolated environment.
   Verify V2 web/Android exports with `EXPO_PUBLIC_GAINLOG_V2_SHELL=1` and the
   flag-off rollback export. Inspect the diff and dependency audit separately;
   do not run a blind audit-fix upgrade.
3. Back up the existing runtime database using the established procedure. Deploy
   the updated backend code to the existing private service and restart normally.
   Verify existing health/workout/nutrition endpoints and a **read-only** GET to
   `/journey` and `/journey/sleep/{date}`. This change does not need a provider
   resync, backfill, goal change, or storage reset.
4. Advance the Android version/code to the next unused release above code 36.
   Use the established local signed ARM64 release workflow, not a new EAS login:

```sh
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo prebuild --platform android
# Reapply the existing release-signing configuration after prebuild.
NODE_ENV=production \
  EXPO_PUBLIC_API_URL='https://gainlog-api.tailc88c35.ts.net' \
  EXPO_PUBLIC_GAINLOG_V2_SHELL=1 \
  ./android/gradlew -p android \
    :react-native-worklets:prefabReleasePackage app:assembleRelease \
    -PreactNativeArchitectures=arm64-v8a
```

5. Verify package `com.gainlog.app`, version/code, ABI, signature continuity and
   APK integrity. Stage via the established checksum-verified private delivery
   to `Downloads/Jarvis-APK`, and remove the temporary hosting route afterward.
6. Check cold launch, all five tabs, **both** Train and global Quick Log workout
   paths, hardware back, sheet/keyboard handling, 320px width, large text, and
   TalkBack. Check normal, unavailable and failed-refresh states. No uninstall or
   clear-data operation. The native startup fix must not be replaced.
7. Exercise check-in save/edit/clear, a lost-response retry, sleep planning, a
   food-log review then an edit, and an evening reflection **only against isolated
   test data**. Do not add test food, workouts, weights or targets to the real account.
   Actual user-entered check-ins in normal use are explicit writes by the user.
8. Record the build identity, results, screenshots and remaining issues in PR #3.
   Keep the PR draft until the user approves the device experience. Do not merge
   or promote production automatically.

## Rollback and remaining depth

Rebuild with the full-shell flag disabled (and previous single-tab setting) to
restore the prior navigation; retain the additive tables. Reverting the connected
experience commit restores the working 1.1.19-era frontend; the additional tables
can remain for preservation. Do not drop user check-ins as a rollback step.

Causal experiments, multi-event journaling, automatic plan optimization, clinical
BP/lab analysis, and validated healthspan/biological-age scoring are NOT shipped.
No claims of causality, live emotional-stress measurement, or calibrated medical
confidence are made. Older detailed training/food editors remain intentionally
familiar. The improvement is the connected day and feedback loop, not a rewrite
of every underlying form.
