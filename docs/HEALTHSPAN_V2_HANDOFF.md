# GainLog V2 — Connected day / Build Your Healthspan

## One authoritative branch

Continue **`feat/healthspan-v2-shell` / PR #3**. This extends Jarvis's working
`056325b7df9b1c0cedb23f25ff90a4b2d95353e8` (1.1.19, Android code 36), preserving
the declarative cold start, dedicated `/workout` route, tab-height fix, app ID,
signing lineage, and existing logging workflows. Do not use the older parallel
PR #4. Do not merge main or deploy automatically.

The interrupted implementation was recovered from verified source tree
`8691c9d60dd6845d1b8a5a0893abc495d6f2d3db`, then tightened around draft revision
conflicts and first-load/rollover behavior. Temporary delivery patches and their
publishing workflow are removed. Actual application source is now in this branch.

## Product scope

Today leads with a rule-based, connected daily brief: morning, daytime,
after-training and evening. It connects the local day, recorded workouts, food
entries, available sleep/recovery signals, the existing weekday template and an
optional self-report. Completed exercise is acknowledged; low energy or soreness
is not dismissed by a high recovery estimate. Missing/stale inputs are not
instructions to train or eat. The brief does not alter scores, plans or targets.

Check-ins support optional energy, soreness and perceived stress (1–5), training
intention, one daily note, an optional stress-timeline minute link and an evening
reflection. This is one editable daily entry, not a multi-event journal or causal
correlation engine. A note does not establish what caused physiological activation.

Sleep planning saves the user's chosen wake time, time-in-bed window and wind-down
lead time. No inferred sleep requirement, alarm or notification is introduced.
Weekly focus is a preference, not a new health goal. Health shows seven completed
local days of sleep, recorded training, movement, nutrition logging and reported
stress, with coverage and saved reflections. These are descriptive foundations,
not biological age, a healthspan score or a validated coaching model.

Fuel presents saved protein/fiber ranges and explicit food-log review. Its
non-security fingerprint invalidates a review after a food entry changes or is
removed. Reviewing a log does not independently establish complete intake.

Recovery/load details are composed explanations. Sleep detail reads one preferred
main session, its actual stage intervals and prior nights. Missing or invalid
stages are withheld, not manufactured. Stress supports touch selection and
accessible previous/next controls. Quick Log now reaches `/workout` correctly.

## Backend required — NOT an APK-only update

`backend/journey.py` adds `journey_day` and `journey_preferences` through the
existing SQLModel schema startup. Its router is registered before lifespan runs.
No new Python dependency, destructive migration, scoring formula, provider
reconciliation, OAuth, MCP or stored-goal change is required.

New routes use the application's existing **private single-user API boundary**:

- `GET /journey?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` (1–35 inclusive days).
- `PATCH /journey/days/{date}` with `expectedRevision` and explicit partial fields.
- `DELETE /journey/days/{date}?expectedRevision=N` erases values/notes and retains
  only a monotonic revision tombstone to prevent stale recreation.
- `PATCH /journey/preferences` with `expectedRevision`.
- `GET /journey/sleep/{date}` returns selected night, stages and prior-night history.

Writes use optimistic compare-and-swap. Editors pin the revision present when the
draft opened; foreground refresh cannot silently rebase an old draft onto a new
record. Stale drafts must be closed/reopened to review the saved entry. Requests
are bounded and abortable. A lost save confirmation blocks more writes until a
fresh read. Date and response validation prevent publishing malformed confirmations.
There is no offline write queue. An old backend returns an update-needed state.

New check-ins are not copied to local unencrypted persistence, AI prompts, wearable
providers or public logs. Responses use `Cache-Control: no-store`. Preserve the
private API access controls; do not expose these endpoints publicly.

Check-in days use the device's IANA time zone. Physiology still follows the existing
America/New_York pipeline. Sleep planning uses local clock times, not a promise of
elapsed hours across DST; multi-timezone physiology is not newly solved here.

## Verification and acceptance

See the latest PR #3 checkpoint and Actions run for exact commit-specific results.
The configured frontend suite includes 30 connected-day tests, plus retained V2,
logging, sync and chart tests. Coverage includes brief phase changes, self-report
versus wearable disagreement, missing/stale days, future/duplicate records, food
review invalidation, midnight planning, and pinned editor revisions.

Backend tests use only isolated synthetic fixtures. They cover additive startup,
partial updates, conflicts, erasure, invalid inputs, bounded dates, unchanged
existing domains, preferred sleep-session selection and invalid stage withholding.
JavaScript exports are NOT native APKs or proof of physical-device behavior.

Use an isolated worktree, preserving local work and existing environment files:

```sh
git fetch origin
git worktree add ../gainlog-connected-day origin/feat/healthspan-v2-shell
cd ../gainlog-connected-day
npm ci
npm test
npx tsc --noEmit
npm run lint
GAINLOG_DATABASE_URL=sqlite:////tmp/gainlog-test.db python -m pytest backend/tests -q
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo export --platform web --output-dir dist-journey-web
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo export --platform android --output-dir dist-journey-android
EXPO_PUBLIC_GAINLOG_V2_SHELL=0 EXPO_PUBLIC_GAINLOG_V2_TODAY=0 npx expo export --platform web --output-dir dist-journey-rollback
```

Use the repo-compatible Node version (CI uses Node 24). Older Node 22 may require
`NODE_OPTIONS=--experimental-strip-types`. Never point tests at the real database.

## Jarvis delivery: established local signed workflow, not EAS

1. Verify the current branch/commit and preserve the working tree. Check for newer
   Jarvis changes before building; do not reset, overwrite or force-push them.
2. Back up the runtime database using the established process. Deploy this branch's
   backend through the normal service workflow; restart so additive tables exist.
   Verify `/journey` and `/journey/sleep/{date}` with read-only calls. Check existing
   domains still work. Do not run provider resync, reimport or database reset.
3. Advance version/build metadata to the next unused version above code 36, checking
   the actual current installed lineage. Keep `com.gainlog.app` and release signing.
4. Generate/prebuild with `EXPO_PUBLIC_GAINLOG_V2_SHELL=1`, preserve/reapply the
   established local release signing configuration, and use the same ARM64 path:

```sh
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo prebuild --platform android
# Reapply the established private signing configuration; never commit key material.
NODE_ENV=production \
EXPO_PUBLIC_API_URL='https://gainlog-api.tailc88c35.ts.net' \
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 \
./android/gradlew -p android \
  :react-native-worklets:prefabReleasePackage app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a
```

5. Verify package, version, ZIP integrity, certificate continuity, API URL and flag.
   Stage the checksum-verified APK to `Downloads/Jarvis-APK/` through the existing
   private delivery workflow; remove temporary hosting afterward. Install in place:
   **no uninstall or clear-data step**. No Expo login/token is needed for this path.
6. Record build ID, checksum, commands, results and non-sensitive screenshots in
   PR #3. Keep it draft/unmerged until physical-device acceptance and user approval.

## Device checks

Verify cold launch, all tabs, Quick Log and Train to `/workout`, back navigation,
existing editors, large system text, narrow widths, keyboard and launcher icons.
Test morning, post-workout, evening, missing model, old backend and offline states.

Use isolated test data for check-in save/edit/clear, sleep plan, weekly focus, food
review invalidation, lost save confirmation and revision conflicts. Open an editor,
change the saved record elsewhere, refresh and confirm the old draft cannot
silently overwrite it. Check midnight rollover and that a recorded workout is not
presented as still awaiting completion. Test actual sleep-stage gaps and stress
selection. Never use the user's real goals/logs as write-test fixtures.

Rollback may disable the full-shell flag and restore the previous single-tab flag,
or revert this feature while retaining the additive tables. Preserve all existing
and newly user-entered records. Do not drop tables as an automatic rollback step.
