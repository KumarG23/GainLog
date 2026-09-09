# Cardio modality swaps

The Log screen offers **Swap cardio** between Elliptical and Treadmill for both manually added cardio and template cardio (Recovery and optional finishers).

- Confirming a swap preserves minutes, miles, the prescription, and the selected workout template.
- Resistance and incline are cleared rather than converted. Cancellation leaves the draft unchanged.
- Treadmill uses `inclinePercent` and displays **INCLINE (%)**. Other cardio retains `resistanceLevel`.
- Incline is independently persisted, rendered in session detail, and included with a percent unit in workout coaching context.
- Existing resistance values are never reinterpreted as incline. This feature does not edit already-saved sessions.

## Release sequencing

Back up the production SQLite database and deploy the backend before the frontend/native app. Startup adds nullable `exercise.incline_percent` using the existing additive migration path. Older clients remain compatible. A frontend-only release against the old backend would silently lose incline values, because that backend does not recognize the field.

This change is source-tested and Android/web-exported, not a signed APK or production deployment. No historical workout correction is included.

## Verification

- `npm run test:workout-templates` includes modality helper and UI wiring regressions.
- Workout history and PR suites verify cardio remains outside strength-history logic.
- `backend/tests/test_workouts.py` exercises zero/fractional incline persistence, legacy resistance preservation, and repeated startup migration on a legacy schema.
- Focused workout/daily-review backend tests, TypeScript, lint, Android and web exports passed.
- Mobile-width browser acceptance exercised both swap directions, preserved duration/distance, cleared machine settings, and verified cancellation. API traffic was blocked during this UI check; no production health data was read or written.
