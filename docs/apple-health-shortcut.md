# RENPHO → Apple Health → GainLog

This Shortcut reads the latest RENPHO-synced Apple Health measurement and sends it to GainLog over Tailscale.

## What syncs automatically

Apple Health exposes the RENPHO values that map to HealthKit quantity types:

- Weight
- Body Fat Percentage
- Lean Body Mass
- Body Mass Index (BMI)

RENPHO-only estimates such as visceral fat, subcutaneous fat, body water, metabolic age, and protein percentage do not reliably map into Apple Health. Those can be backfilled later from a RENPHO export.

## Prerequisites

1. RENPHO Health is already writing data to Apple Health.
2. Tailscale is installed and connected on the iPhone.
3. Opening `https://gainlog-api.tailc88c35.ts.net/health` in Safari returns `{"status":"ok"}`.

## Build the Shortcut

Create a new Shortcut named **Sync RENPHO to GainLog**.

### 1. Wait for RENPHO to finish syncing

Add:

- **Wait** — `5 seconds`

### 2. Read the latest weight

Add **Find Health Samples**:

- Type: `Weight`
- Sort by: `Start Date`
- Order: `Latest First`
- Limit: `1`

Rename its result variable to `Weight Sample`.

Add **If** `Weight Sample` **does not have any value**:

- **Stop This Shortcut** with output `No weight sample found`

Then add:

- **Get Details of Health Samples** → `Value` from `Weight Sample`; rename to `Weight Value`
- **Get Numbers from Input** → `Weight Value`; rename to `Weight Number`
- **Get Details of Health Samples** → `Start Date` from `Weight Sample`; rename to `Measurement Date`
- **Format Date** → `Measurement Date`, Custom format: `yyyy-MM-dd'T'HH:mm:ssZZZZZ`; rename to `Measurement ISO`

### 3. Create a ±5-minute measurement window

Add:

- **Adjust Date** → Subtract `5 minutes` from `Measurement Date`; rename to `Window Start`
- **Adjust Date** → Add `5 minutes` to `Measurement Date`; rename to `Window End`

This prevents a fresh weight from being paired with a stale body-fat value.

### 4. Create the base payload

Add a **Dictionary** with:

- `date` → `Measurement ISO`
- `weightLbs` → `Weight Number`
- `source` → text `apple-health`
- `sourceRecordId` → `Measurement ISO`

Rename it to `Payload`.

### 5. Add optional composition values

Repeat the following pattern for each Health type below:

1. **Find Health Samples** of the specified type.
2. Filter `Start Date` is between `Window Start` and `Window End`.
3. Sort by `Start Date`, latest first; limit `1`.
4. **If** the result has any value:
   - Get its `Value` detail.
   - Run **Get Numbers from Input** on the value.
   - Use **Set Dictionary Value** on `Payload` with the matching JSON key.

| Apple Health type | JSON key |
|---|---|
| Body Fat Percentage | `bodyFatPercent` |
| Lean Body Mass | `leanBodyMassLbs` |
| Body Mass Index | `bmi` |

Important: every **Set Dictionary Value** action should update the `Payload` variable for the next action.

### 6. Send to GainLog

Add **Get Contents of URL**:

- URL: `https://gainlog-api.tailc88c35.ts.net/body-weight/import`
- Method: `POST`
- Request Body: `JSON`
- JSON: choose the `Payload` dictionary variable

Add **Show Result** using the response from **Get Contents of URL** for the first test. Once verified, remove **Show Result** so automation stays quiet.

## Automate it

In Shortcuts → Automation:

1. Create a Personal Automation.
2. Trigger: **App**.
3. Choose **RENPHO Health**.
4. Select **Is Closed**.
5. Run **Sync RENPHO to GainLog**.
6. Set it to run immediately without confirmation if iOS offers that option.

The Shortcut waits five seconds after RENPHO closes, reads the Health samples RENPHO just wrote, and upserts the measurement by source plus timestamp.

## API payload example

```json
{
  "date": "2026-07-30T06:07:06-04:00",
  "weightLbs": 207.6,
  "bodyFatPercent": 24.6,
  "leanBodyMassLbs": 156.6,
  "bmi": 29.0,
  "source": "apple-health",
  "sourceRecordId": "2026-07-30T06:07:06-04:00"
}
```

A new measurement returns HTTP `201`. Re-sending the same `sourceRecordId` returns HTTP `200` and updates the existing record instead of creating a duplicate.

## Troubleshooting

- **Could not connect:** Open Tailscale and confirm it is connected, then test the `/health` URL in Safari.
- **Weight imports but composition does not:** Check Apple Health → Browse → Body Measurements and confirm RENPHO wrote those specific sample types.
- **Body-fat value becomes `0.246` instead of `24.6`:** Add a **Calculate** action multiplying the extracted Body Fat Percentage number by `100` before setting `bodyFatPercent`. Apple Health/Shortcuts formatting can vary by iOS version.
- **Duplicate entries:** Confirm `sourceRecordId` uses the formatted `Measurement ISO`, not the current time when the Shortcut runs.
