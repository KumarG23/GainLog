"""Private, one-way GainLog -> Google Sheets mirror. Never provisions or shares Drive files."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

EASTERN = ZoneInfo("America/New_York")
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
HEADERS = {
    "Daily": ["Date", "Weight (lb)", "Body fat %", "RHR", "HRV", "Sleep (min)", "CPAP hours", "CPAP AHI", "Steps", "Active kcal", "Workout template", "Strength min", "Cardio min", "Zone-2 min", "BP sys avg", "BP dia avg", "Calories", "Protein", "Carbs", "Fat", "Fiber", "UPF dinner (Y/N)", "Fatty fish (Y/N)", "Supplements taken (%)", "Days-logged flag", "Notes"],
    "Workouts": ["ID", "Date", "Duration (min)", "Avg HR", "Active kcal", "Total kcal", "Notes", "Insight", "Template", "Effort", "Pain"],
    "Exercise Sets": ["ID", "Workout ID", "Exercise ID", "Exercise", "Kind", "Position", "Set position", "Reps", "Weight", "Seconds", "measure"],
    "Meals": ["ID", "Date", "Meal", "Name", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)", "Notes", "Position", "Tags"],
    "Benchmarks": ["Date", "protocol", "avg HR min 10–20", "notes", "Workout ID"],
    "BP": ["ID", "Date", "Time", "Systolic", "Diastolic", "Pulse", "Arm", "Position", "Source"],
    "Weekly": ["Week start", "Week end", "Sleep avg (min)", "Strength sessions", "Interval sessions", "Zone-2 min", "Steps avg", "RHR avg", "HRV avg", "Weight avg (lb)", "Protein avg (g)", "Fiber avg (g)", "Calories avg", "Days logged", "BP sys avg", "BP dia avg", "CPAP nights >= 6h", "UPF dinners", "Fatty-fish meals", "Supplement adherence (%)", "One change"],
    "Labs": ["Date", "Marker", "Value", "Unit", "Reference range"],
    "README": ["Item", "Value"],
}
KEY_COL = {"Daily": 0, "Workouts": 0, "Exercise Sets": 0, "Meals": 0, "Benchmarks": 4, "BP": 0, "Weekly": 0}


def local_date(value: str) -> str:
    if len(value) == 10:
        return date.fromisoformat(value).isoformat()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must have an offset")
    return parsed.astimezone(EASTERN).date().isoformat()


def clean(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Y" if value else "N"
    return value


def _analysis(workout):
    try:
        return json.loads(workout.cardio_analysis_json or "{}")
    except (ValueError, TypeError):
        return {}


def project(db: Session) -> dict[str, list[list]]:
    """Only authoritative persisted records; absent domains remain blank, never zero."""
    try:
        from .main import (AppleHealthDailyDB, BodyWeightEntryDB, ExerciseDB, NutritionEntryDB,
                           WeeklyReviewDB, WorkoutSessionDB, WorkoutSetDB)
        from .longevity import BPReadingDB, CPAPNightDB
    except ImportError:
        from main import (AppleHealthDailyDB, BodyWeightEntryDB, ExerciseDB, NutritionEntryDB,
                          WeeklyReviewDB, WorkoutSessionDB, WorkoutSetDB)
        from longevity import BPReadingDB, CPAPNightDB

    rows = {name: [] for name in KEY_COL}
    daily = defaultdict(lambda: [""] * len(HEADERS["Daily"]))
    workouts_by_date = defaultdict(list)
    for h in db.exec(select(AppleHealthDailyDB)).all():
        r = daily[h.date]
        r[0] = h.date
        for i, value in ((3, h.resting_heart_rate_bpm), (4, h.hrv_ms), (5, h.sleep_minutes),
                         (8, h.steps), (9, h.active_calories)):
            r[i] = clean(value)
    for w in db.exec(select(BodyWeightEntryDB).order_by(BodyWeightEntryDB.date, BodyWeightEntryDB.id)).all():
        d = local_date(w.date)
        r = daily[d]
        r[0], r[1], r[2] = d, clean(w.weight_lbs), clean(w.body_fat_percent)
    for night in db.exec(select(CPAPNightDB)).all():
        r = daily[night.day]
        r[0], r[6], r[7] = night.day, night.hours, night.ahi
    bp_groups = defaultdict(list)
    for reading in db.exec(select(BPReadingDB).order_by(BPReadingDB.time, BPReadingDB.id)).all():
        rows['BP'].append([reading.id, reading.day, reading.time, reading.systolic,
                           reading.diastolic, clean(reading.pulse), clean(reading.arm),
                           clean(reading.position), reading.source])
        bp_groups[reading.day, reading.pair_id or reading.id].append(reading)
    day_bp = defaultdict(list)
    for (day, _), readings in bp_groups.items():
        day_bp[day].append((sum(r.systolic for r in readings)/len(readings),
                            sum(r.diastolic for r in readings)/len(readings)))
    for day, sessions in day_bp.items():
        r = daily[day]
        r[0] = day
        r[14], r[15] = (round(sum(item[i] for item in sessions)/len(sessions), 1) for i in (0, 1))
    workouts = db.exec(select(WorkoutSessionDB).order_by(WorkoutSessionDB.date, WorkoutSessionDB.id)).all()
    exercises = db.exec(select(ExerciseDB).order_by(ExerciseDB.session_id, ExerciseDB.position)).all()
    sets = db.exec(select(WorkoutSetDB).order_by(WorkoutSetDB.exercise_id, WorkoutSetDB.position)).all()
    by_session = defaultdict(list)
    by_exercise = defaultdict(list)
    for ex in exercises:
        by_session[ex.session_id].append(ex)
    for item in sets:
        by_exercise[item.exercise_id].append(item)
    for w in workouts:
        d = local_date(w.date)
        workouts_by_date[d].append(w)
        r = daily[d]
        r[0] = d
        r[10] = clean(w.template_id)
        r[11] = clean(w.strength_duration_minutes)
        r[12] = clean(w.cardio_duration_minutes)
        analysis = _analysis(w)
        # Zone-2 is valid only when backed by sample coverage and verified segment windows.
        r[13] = clean(analysis.get("zone2Minutes")) if analysis.get("windowSource") != "unverified" else ""
        r[25] = clean(w.notes)
        rows["Workouts"].append([w.id, w.date, w.duration_minutes, clean(w.avg_heart_rate),
            clean(w.active_calories), clean(w.total_calories), clean(w.notes), clean(w.insight),
            clean(w.template_id), clean(w.effort), clean(w.pain)])
        if analysis.get("protocolCompliant") and analysis.get("benchmarkAverageHr") is not None:
            rows["Benchmarks"].append([d, "Treadmill 3.0 mph / 7% / 20 min", analysis["benchmarkAverageHr"], clean(w.notes), w.id])
        for ex in by_session[w.id]:
            for item in by_exercise[ex.id]:
                rows["Exercise Sets"].append([item.id, w.id, ex.id, ex.name, ex.kind,
                    ex.position, item.position, clean(item.reps) if item.measure == "reps" else "",
                    clean(item.weight), clean(item.seconds) if item.measure == "seconds" else "", item.measure])
    for meal in db.exec(select(NutritionEntryDB).order_by(NutritionEntryDB.date, NutritionEntryDB.position)).all():
        d = local_date(meal.date)
        r = daily[d]
        r[0] = d
        for i, value in ((16, meal.calories), (17, meal.protein_g), (18, meal.carbs_g),
                         (19, meal.fat_g), (20, meal.fiber_g)):
            r[i] = (r[i] if r[i] != "" else 0) + value
        rows["Meals"].append([meal.id, d, meal.meal, meal.name, meal.calories, meal.protein_g,
            meal.carbs_g, meal.fat_g, meal.fiber_g, clean(meal.notes), meal.position, ""])
    for d, r in daily.items():
        # A partial day's meals do not establish full logging.
        rows["Daily"].append(r)
    rows["Daily"].sort(key=lambda r: r[0])
    reviews = {review.week_start: review for review in db.exec(select(WeeklyReviewDB)).all()}
    weeks = set(reviews) | { (date.fromisoformat(d) - timedelta(days=date.fromisoformat(d).weekday())).isoformat() for d in daily }
    def avg(values):
        values = [v for v in values if v != ""]
        return round(sum(values) / len(values), 2) if values else ""
    for week in sorted(weeks):
        days = [daily.get((date.fromisoformat(week) + timedelta(days=i)).isoformat()) for i in range(7)]
        populated = [r for r in days if r is not None]
        ws = [w for i in range(7) for w in workouts_by_date.get((date.fromisoformat(week) + timedelta(days=i)).isoformat(), [])]
        def field(index):
            return avg([r[index] for r in populated])
        zone = [r[13] for r in populated if r[13] != ""]
        review = reviews.get(week)
        # Free-form review text is not a structured 'one change' field.
        rows["Weekly"].append([week, (date.fromisoformat(week) + timedelta(days=6)).isoformat(),
            field(5), sum(1 for w in ws if w.strength_duration_minutes and w.strength_duration_minutes > 0) if ws else "",
            sum(1 for w in ws if w.template_id == "intervals") if ws else "", sum(zone) if zone else "",
            field(8), field(3), field(4), field(1), field(17), field(20), field(16), "", field(14), field(15),
            sum(r[6] >= 6 for r in populated if r[6] != "") if any(r[6] != "" for r in populated) else "", "", "", "", ""])
    return rows


class SheetsClient:
    """Scoped Sheets API only; never requests Drive permissions."""
    def __init__(self, credentials_path: str):
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        info = json.loads(Path(credentials_path).read_text())
        if info.get("type") != "service_account" or not info.get("client_email"):
            raise ValueError("GAINLOG_HEALTH_HUB_CREDENTIALS must be a service-account JSON")
        self.email = info["client_email"]
        self.http = AuthorizedSession(service_account.Credentials.from_service_account_info(info, scopes=[SHEETS_SCOPE]))

    def request(self, method, sheet_id, suffix, payload=None):
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{quote(sheet_id, safe='')}{suffix}"
        response = self.http.request(method, url, json=payload, timeout=45)
        response.raise_for_status()
        return response.json()

    def metadata(self, sheet_id):
        return self.request("GET", sheet_id, "?fields=spreadsheetId,sheets.properties.title")

    def read(self, sheet_id, tab):
        return self.request("GET", sheet_id, "/values/" + quote(f"'{tab}'!A1:AZ", safe="") + "?valueRenderOption=UNFORMATTED_VALUE", None).get("values", [])

    def write(self, sheet_id, tab, start, values):
        end = start + len(values) - 1
        address = quote(f"'{tab}'!A{start}:AZ{end}", safe="")
        return self.request("PUT", sheet_id, f"/values/{address}?valueInputOption=RAW",
                            {"majorDimension": "ROWS", "values": values})


def sync(db, sheets, sheet_id: str, now=None):
    if not sheet_id or not sheet_id.strip():
        raise ValueError("GAINLOG_HEALTH_HUB_SHEET_ID is required")
    titles = {s["properties"]["title"] for s in sheets.metadata(sheet_id)["sheets"]}
    missing = set(HEADERS) - titles
    if missing:
        raise ValueError("missing Health Hub tabs: " + ", ".join(sorted(missing)))
    projected = project(db)
    counts = {}
    for tab, key_col in KEY_COL.items():
        existing = sheets.read(sheet_id, tab)
        if existing and existing[0] != HEADERS[tab]:
            raise ValueError(f"{tab} header mismatch; refusing to overwrite")
        if not existing:
            sheets.write(sheet_id, tab, 1, [HEADERS[tab]])
            existing = [HEADERS[tab]]
        indexes = {}
        for index, row in enumerate(existing[1:], start=2):
            if len(row) <= key_col or not row[key_col]:
                continue
            key = str(row[key_col])
            if key in indexes:
                raise ValueError(f"duplicate {tab} key {key}; manual repair required")
            indexes[key] = index
        for row in projected[tab]:
            key = str(row[key_col])
            formatted = [clean(value) for value in row]
            if key in indexes:
                current = existing[indexes[key] - 1]
                if [str(x) for x in current] == [str(x) for x in formatted[:len(current)]] and all(x == "" for x in formatted[len(current):]):
                    continue
                sheets.write(sheet_id, tab, indexes[key], [formatted])
            else:
                position = len(existing) + 1
                sheets.write(sheet_id, tab, position, [formatted])
                existing.append(formatted)
                indexes[key] = position
        verified = sheets.read(sheet_id, tab)
        readback = {str(row[key_col]): row for row in verified[1:] if len(row) > key_col and row[key_col]}
        expected_keys = {str(row[key_col]) for row in projected[tab]}
        if not expected_keys.issubset(readback):
            raise RuntimeError(f"{tab} readback missing exported keys; freshness not advanced")
        for row in projected[tab]:
            actual = readback[str(row[key_col])]
            expected = [str(clean(value)) for value in row]
            if [str(value) for value in actual] != expected[:len(actual)] or any(value != "" for value in expected[len(actual):]):
                raise RuntimeError(f"{tab} readback differs from source; freshness not advanced")
        counts[tab] = len(expected_keys)
    for tab in ("Labs", "README"):
        existing = sheets.read(sheet_id, tab)
        if existing and existing[0] != HEADERS[tab]:
            raise ValueError(f"{tab} header mismatch")
        if not existing:
            sheets.write(sheet_id, tab, 1, [HEADERS[tab]])
    timestamp = (now or datetime.now(timezone.utc)).astimezone(EASTERN).isoformat()
    readme = [["Last successful sync (Eastern)", timestamp],
              ["Source", "GainLog backend, authoritative persisted records; one-way mirror"],
              ["Timezone", "America/New_York; weeks Monday–Sunday"],
              ["Null semantics", "Blank = not logged or unavailable; zero = recorded zero"],
              ["Unavailable domains", "CPAP, BP, supplement adherence, meal tags, full-day flag and structured one change pending source models; not inferred"],
              ["Labs", "Owner-managed manual rows; exporter never writes Labs data"]]
    sheets.write(sheet_id, "README", 2, readme)
    return counts


def main():
    parser = argparse.ArgumentParser(description="Sync private Health Hub; no Drive provisioning/sharing")
    parser.add_argument("--check", action="store_true", help="Validate scoped credentials and existing sheet; do not export")
    args = parser.parse_args()
    sheet_id = os.getenv("GAINLOG_HEALTH_HUB_SHEET_ID", "")
    credentials = os.getenv("GAINLOG_HEALTH_HUB_CREDENTIALS", "")
    if not sheet_id or not credentials:
        parser.error("disabled: GAINLOG_HEALTH_HUB_SHEET_ID and GAINLOG_HEALTH_HUB_CREDENTIALS (service-account path) required")
    client = SheetsClient(credentials)
    if args.check:
        print(json.dumps({"status": "authorized", "sheet_id": sheet_id, "service_account": client.email,
                          "tabs": [s["properties"]["title"] for s in client.metadata(sheet_id)["sheets"]]}))
        return
    try:
        from .main import engine
    except ImportError:
        from main import engine
    # Serializes scheduled and operator-triggered jobs on the same host.
    with open("/run/lock/gainlog-health-hub.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with Session(engine) as db:
            counts = sync(db, client, sheet_id)
    print(json.dumps({"status": "synced", "sheet_id": sheet_id, "rows": counts}))


if __name__ == "__main__":
    main()
