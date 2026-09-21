# GainLog V2 — Build Your Healthspan

## Status and scope

Review/build candidate, not a deployed or device-verified release. Prepared from
`main` at `66d15521a825e3359478af457e79c8346634f8cb` on 2026-09-21.
The user explicitly requested that ChatGPT take over this UI implementation and
that Jarvis pull the changes, validate, and deliver the app. Keep this work on
`feat/healthspan-v2-shell` until the gates below pass; do not force-push main.

This is the first cohesive five-tab UI pass, not a completed clinical analytics
product. It provides Today, Health, Train, Fuel, and Trends; a shared dark/mint
visual system; quick-log actions; an explainable Today screen; and the Baseline G
identity with the tagline **BUILD YOUR HEALTHSPAN**.

Existing workout logging, food entry, workout history/statistics, health/goal
forms, session details, and trend-detail routes remain in place. The hubs link to
those established flows. Their layout has not been comprehensively redesigned;
they inherit the V2 palette. No backend, scoring formula, database, ingestion,
OAuth, MCP, goal value, or stored health record is changed. No private health
measurements, account names, access tokens, or signing material are included.

## Navigation and flags

`EXPO_PUBLIC_GAINLOG_V2_SHELL=1` enables the full shell and native branding.
A cold root launch redirects once to `/(tabs)/today`. Subsequent visits to
`/(tabs)` still open the existing workout form. Do not replace this behavior
without checking template/resume/deep-link callers.

Visible routes: `today`, `healthspan`, `train`, `fuel`, `insights`.
Existing `index`, `history`, `stats`, `health`, and `nutrition` routes are hidden
from the V2 tab bar, not deleted. Hidden forms have an overview-return button.
When the full shell is enabled, `isHealthV2TodayEnabled()` deliberately returns
false: the old Health route must expose its weight/goal forms. The new Today
route renders `TodayV2` directly. With the full-shell flag off, the old
`EXPO_PUBLIC_GAINLOG_V2_TODAY` flag retains its original routing purpose.

Flags are build-time public flags, not secrets or runtime toggles. Rollback needs
a rebuild/export with the full-shell flag off. Reverting this branch restores the
exact previous Today implementation; flag rollback alone restores navigation
and legacy colors, but the revised Today component still exists.

## Data honesty and boundaries

- Today estimates remain experimental GainLog models, not WHOOP or Fitbit scores.
  Confidence is not a medically calibrated accuracy probability.
- Stress is retrospective physiological activation. The timeline covers 00:00
  to 24:00, with separate exercise, activity, sleep, unscored and future states.
  The marker reflects the response's elapsed time; it is not a streaming sensor.
- Response-check time is explicitly not device-sync time. Request failures leave
  a stale-data warning; day rollover clears the previous Today's estimate.
- Trend averages use completed local calendar days. Comparing two seven-day
  windows requires four observed days in each and no row-level source change.
  Gaps stay gaps, measured zeroes stay zeroes. This is descriptive comparison,
  not statistical significance, per-device provenance, or causality.
- Fuel uses saved goals and logged intake, never treats an incomplete log as a
  complete diet, and never edits targets automatically. Training counts are
  Monday-to-date logged sessions rather than lifetime counts.
- No biological-age, longevity score, blood-pressure data, or correlation engine
  has been fabricated. Richer sleep/health drill-downs and personal experiments
  remain later phases.

## Branding and builds

The canonical vector is `assets/source/gainlog-baseline-g.svg`; the in-app SVG
uses the same geometry. `scripts/generate-healthspan-brand.cjs` creates opaque
app-icon, transparent adaptive-foreground, monochrome, splash, and favicon PNGs
without external image packages or network access. Adaptive foreground geometry
is padded inside the central safe region. Inspect actual launcher masks on-device.

`app.config.ts` generates the assets when the full-shell flag is enabled and
preserves the existing app identifiers, permissions, version, EAS project,
plugins and unrelated settings. Generated PNGs in `assets/healthspan` are ignored
and reproducible. The existing `app.json` is unchanged.

A separate `healthspan-preview` EAS profile extends `preview`, sets the flag on
the remote build, requests an internal Android APK, and increments the remote
native build number. Existing development/preview/production profiles are kept.
Do not ship this as an OTA-only branding change; build a new native APK.

## Verification actually performed here

- 25 focused Node tests passed via `tests/healthV2Today.test.mjs`, which now also
  includes `healthspan.test.mjs`. Existing Today assertions were retained.
- All 16 changed TypeScript/TSX files parsed/transpiled without syntax diagnostics.
- The two pure utility modules passed strict TypeScript checking.
- The native-asset generator passed `node --check`, generated all five PNGs, and
  its app icon was visually inspected. PNG signature/dimensions are unit-tested.

**Not performed:** full dependency-resolved application type check, repository-wide
suite, Expo lint/export, browser rendering, Android build/install, accessibility
or device interaction testing. The execution environment could read/write GitHub
through the connector but could not resolve GitHub for a clone or download Expo
dependencies. Publication uses GitHub Git Data rather than a local full checkout.
Do not interpret helper type checks or TSX transpilation as full app validation.

## Jarvis: required validation and delivery

Use a clean worktree; do not discard local changes. Fetch the branch and review
its diff against the recorded base. If main advanced, reconcile it before build.

```sh
git fetch origin
git worktree add ../gainlog-healthspan-v2 origin/feat/healthspan-v2-shell
cd ../gainlog-healthspan-v2
npm ci
npm test
npx tsc --noEmit
npm run lint
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo export --platform web --output-dir dist-healthspan-web
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo export --platform android --output-dir dist-healthspan-android
EXPO_PUBLIC_GAINLOG_V2_SHELL=0 EXPO_PUBLIC_GAINLOG_V2_TODAY=0 npx expo export --platform web --output-dir dist-healthspan-rollback
```

Use a Node version supported by the repo's native TypeScript tests; older Node 22
releases may require `NODE_OPTIONS=--experimental-strip-types`. The new tests are
included by the existing `test:v2-today` command and therefore by `npm test`.

Run the following device checks before marking the pull request ready:

1. Cold launch reaches Today; all five tabs work. Root-to-workout, back navigation,
   old deep links, notification links, session detail and trend-detail routes work.
2. Create/edit/delete a test food entry and a workout through the existing forms;
   verify expected sync behavior. Verify weight and goal forms with explicit test
   inputs; do not change the user's real targets as a test.
3. Test empty account, unavailable score, partial baseline, observed zero, source
   change, failed refresh with cached data, foreground refresh and midnight rollover.
4. Confirm stress future segments and marker align with local time. The backend
   still uses its existing America/New_York convention; multi-timezone support is
   not newly solved by this UI work.
5. Check 320px width, large text, Android gesture/button navigation, keyboard,
   modal close/back, TalkBack, chart detail labels and all launcher-icon masks.
6. Review screenshots on-device, confirm no clinical certainty or live-sync claim,
   and compare a few displayed observations with the actual backend response.

After the gates pass, use GainLog's established local signed-release workflow. The
`healthspan-preview` EAS profile remains available, but EAS authentication is not
required for Neal's normal private APK delivery path:

```sh
EXPO_PUBLIC_GAINLOG_V2_SHELL=1 npx expo prebuild --platform android
# Reapply the established release-signing configuration after prebuild.
NODE_ENV=production \
  EXPO_PUBLIC_API_URL='https://gainlog-api.tailc88c35.ts.net' \
  EXPO_PUBLIC_GAINLOG_V2_SHELL=1 \
  ./android/gradlew -p android \
    :react-native-worklets:prefabReleasePackage \
    app:assembleRelease \
    -PreactNativeArchitectures=arm64-v8a
```

Increment `versionCode`, preserve the established signing certificate, and verify
package/version/ABI/signature before checksum-verified delivery to
`Downloads/Jarvis-APK`. Record commands, results, screenshots and the local build
identity in the pull request. Do not use an OTA-only update for branding changes.
