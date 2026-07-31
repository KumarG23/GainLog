# Apple Health → GainLog

## Recommended route: Health Auto Export

For body composition alone, an Apple Shortcut is manageable. Once sleep stages, HRV, activity rings, and daily totals are included, the Shortcut becomes long and fragile. The practical route is **Health Auto Export**:

```text
RENPHO / Apple Watch / iPhone
            ↓
       Apple Health
            ↓
   Health Auto Export
            ↓ private Tailscale HTTPS
          GainLog
```

No GainLog or RENPHO credentials are stored in the exporter. GainLog accepts only the metrics listed below and discards other metric categories instead of storing the raw payload.

Health Auto Export currently offers a seven-day Premium trial and automated REST exports through its Premium tier. Pricing is controlled by the App Store and may change.

App Store: <https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069>

## What GainLog imports

Body composition:

- Body Mass
- Body Fat Percentage
- Lean Body Mass
- Body Mass Index

Recovery and activity:

- Sleep Analysis, including Core, Deep, and REM stages
- Resting Heart Rate
- Heart Rate Variability
- Step Count
- Active Energy Burned
- Apple Exercise Time
- Apple Stand Hour
- Walking + Running Distance

GainLog intentionally ignores unrelated categories such as medications, symptoms, reproductive health, blood pressure, and nutrition. Add them only through a deliberate schema change—not by turning on every Health permission like a loot goblin.

## Setup

### 1. Confirm private network access

1. Connect the iPhone to Tailscale.
2. In Safari, open:

```text
https://gainlog-api.tailc88c35.ts.net/health
```

Expected result:

```json
{"status":"ok"}
```

Do not continue until this works.

### 2. Install Health Auto Export

1. Install **Health Auto Export - JSON+CSV** from the App Store.
2. Open it and start the Premium trial if prompted.
3. Grant read access only to the metrics in **What GainLog imports** above.

RENPHO must already be writing Body Mass, Body Fat Percentage, Lean Body Mass, and BMI into Apple Health. Apple Watch/iPhone supplies the sleep, heart, and activity data that it records.

### 3. Create the REST automation

In Health Auto Export:

1. Open **Automated Exports**.
2. Tap **New Automation**.
3. Choose **REST API**.
4. Name it:

```text
GainLog
```

5. Use this URL:

```text
https://gainlog-api.tailc88c35.ts.net/apple-health/auto-export
```

6. Set the request timeout to **30 seconds**.
7. No custom authorization header is required. Tailscale device membership is the network authentication boundary; GainLog also allowlists browser origins and rejects browser-originated writes on Apple Health import routes. Native Health Auto Export and Shortcuts send no browser `Origin` header.

### 4. Select the data

Choose **Health Metrics**, then select only:

```text
Active Energy Burned
Apple Exercise Time
Apple Stand Hour
Body Fat Percentage
Body Mass
Body Mass Index
Heart Rate Variability
Lean Body Mass
Resting Heart Rate
Sleep Analysis
Step Count
Walking + Running Distance
```

Use these export settings:

| Setting | Value |
|---|---|
| Format | JSON |
| Export version | Current / Version 2 |
| Date range | Today |
| Summarize data | On |
| Time grouping | Day |
| Batch requests | Off |
| Sync cadence | Every 4 hours |

`Today` keeps each background request small and avoids re-importing older body measurements that may already exist in GainLog. Repeated data is safe: GainLog upserts by calendar date and preserves optional values that are absent from a later request.

### 5. Run the first export

1. Tap **Manual Export** inside the automation.
2. Select **Today** for the initial import.
3. Tap **Export**.
4. A successful response resembles:

```json
{
  "dailySummaries": 1,
  "bodyMeasurements": 1,
  "ignoredMetrics": []
}
```

The counts depend on which records exist today. An empty `ignoredMetrics` list means only the intended categories were sent. Historical recovery data can be backfilled later after checking for existing GainLog body records.

### 6. Help iOS run it reliably

Apple controls background execution; no iOS app can promise an exact cron schedule.

- Keep Tailscale connected.
- Add the Health Auto Export **Automations** widget to the iPhone Home Screen. Its documentation recommends this to improve background execution.
- Leave background app refresh enabled.
- Enable failure notifications for the GainLog automation.
- Charging the phone gives iOS background work more breathing room.

GainLog does not need to be open. Expo Go does not need to be open. The export app sends directly to the backend.

## How GainLog uses the data

The Health screen displays a **Recovery & Activity** card with sleep, resting heart rate, HRV, steps, active calories, exercise time, available sleep stages, stand hours, and walking/running distance. GainLog does not mislabel `inBed - totalSleep` as Apple's actual Awake stage; true awake minutes are shown only when explicitly supplied.

The daily coach receives the same summary. Sleep, resting heart rate, HRV, and smart-scale composition remain trend signals; one odd night or one hydrated scale reading should not trigger a dramatic plan change.

## API contracts

Native Health Auto Export payloads:

```http
POST /apple-health/auto-export
Content-Type: application/json
```

The endpoint accepts Health Auto Export's documented `{ "data": { "metrics": [...] } }` format, converts supported units, ignores unrelated metrics, and performs idempotent daily/body-composition upserts.

Simple daily summaries can also be sent directly:

```http
POST /apple-health/daily/import
Content-Type: application/json
```

```json
{
  "date": "2026-07-31",
  "sleepMinutes": 465,
  "deepSleepMinutes": 72,
  "coreSleepMinutes": 276,
  "remSleepMinutes": 117,
  "awakeMinutes": 30,
  "restingHeartRateBpm": 58,
  "hrvMs": 47,
  "steps": 8123,
  "activeCalories": 645.5,
  "exerciseMinutes": 52,
  "standHours": 12,
  "walkingRunningMiles": 4.6,
  "source": "apple-health"
}
```

Body composition remains available at:

```http
POST /body-weight/import
```

## Free Shortcut fallback

The free route is still possible:

1. Build a Shortcut that reads the latest RENPHO body metrics.
2. Build loops that aggregate each sleep stage.
3. Read and aggregate the activity and recovery metrics.
4. POST body composition to `/body-weight/import`.
5. POST the daily summary to `/apple-health/daily/import`.
6. Run it after weighing and again near bedtime.

That avoids a paid app but requires dozens of Shortcut actions and ongoing maintenance when Apple changes Health actions. It is supported by the API, but it is no longer the recommended “easy” setup.

## Troubleshooting

### Safari cannot open the API health URL

- Confirm Tailscale is connected.
- Confirm the phone is in the correct tailnet.
- Retry `https://gainlog-api.tailc88c35.ts.net/health`.

### Export succeeds but a metric is missing

- Open Health Auto Export permissions and enable that metric.
- Confirm Apple Health itself contains the metric.
- Confirm RENPHO is allowed to write the specific body metric.
- Confirm **Summarize Data** is enabled with **Day** grouping.

### Sleep stages are missing

Apple Health only exports stages it actually has. Without compatible Apple Watch sleep-stage records, total sleep may exist while Core/Deep/REM remain absent.

### Background exports are inconsistent

iOS treats schedules as best effort. Add the Automations widget, keep Background App Refresh and Tailscale enabled, and inspect Health Auto Export's Activity Logs for HTTP or HealthKit errors.
