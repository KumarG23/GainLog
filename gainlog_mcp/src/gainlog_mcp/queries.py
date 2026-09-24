from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sqlite3
import stat
from typing import Iterator

from pydantic import ValidationError

from .exporter import APPLICATION_ID, SCHEMA_VERSION
from .models import (
    BodyCompositionRequest, DailyHealthRequest, DayContextRequest, EmptyRequest, GetWorkoutRequest,
    GoalsRequest, JourneyRequest, ListWorkoutsRequest, MAX_PAGE_OFFSET, NutritionRequest, ReviewsRequest,
    owner_today, parse_date,
)


MAX_STORE_BYTES = 100 * 1024 * 1024
STALE_SECONDS = 15 * 60

REQUESTS = {
    "get_data_coverage": EmptyRequest,
    "list_workouts": ListWorkoutsRequest,
    "get_workout": GetWorkoutRequest,
    "query_nutrition": NutritionRequest,
    "query_body_composition": BodyCompositionRequest,
    "query_daily_health": DailyHealthRequest,
    "query_goals": GoalsRequest,
    "query_saved_reviews": ReviewsRequest,
    "get_journey": JourneyRequest,
    "get_day_context": DayContextRequest,
}

JOURNEY_SEMANTICS = {
    "ratings": "energy_soreness_stress_are_self_reported_1_to_5",
    "physiological_activation": "separate_wearable_derived_concept",
    "nutrition_reviewed": "user_reviewed_log_not_proof_all_intake_was_captured",
    "training_intent": "user_intention_not_completed_activity",
    "weekly_focus": "preference_not_formal_goal",
    "current_preferences": "current_singleton_not_historical_state",
    "missing": "null_means_missing_or_unreported_zero_remains_observed_zero",
    "text": "note_and_reflection_may_be_withheld_by_owner_privacy_configuration",
}


class StoreError(Exception):
    pass


@contextmanager
def open_store(path: Path) -> Iterator[sqlite3.Connection]:
    fd: int | None = None
    db: sqlite3.Connection | None = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STORE_BYTES:
            raise StoreError("store_corrupt")
        db = sqlite3.connect(f"file:/proc/self/fd/{fd}?mode=ro&immutable=1", uri=True)
        db.row_factory = sqlite3.Row
        if db.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
            raise StoreError("store_corrupt")
        if db.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
            raise StoreError("store_corrupt")
        db.execute("PRAGMA query_only=ON")
    except FileNotFoundError:
        raise StoreError("store_unavailable") from None
    except StoreError:
        raise
    except Exception:
        raise StoreError("store_corrupt") from None

    try:
        yield db
    finally:
        if db is not None:
            db.close()
        if fd is not None:
            os.close(fd)


def _metadata(db: sqlite3.Connection) -> dict[str, object]:
    values = dict(db.execute("SELECT key,value FROM metadata").fetchall())
    exported_at = values["exported_at"]
    timestamp = datetime.fromisoformat(exported_at.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    stale = timestamp > now + timedelta(minutes=5) or (now - timestamp).total_seconds() > STALE_SECONDS
    return {
        "exported_at": exported_at,
        "source_db_modified_at": values["source_db_modified_at"],
        "source_fingerprint": values["source_fingerprint"],
        "journey_text_exposure": values["journey_text"],
        "stale": stale,
    }


def _date_clause(column: str, start: str | None, end: str | None) -> tuple[str, list[str]]:
    if start is None or end is None:
        return "", []
    end_exclusive = (parse_date(end) + timedelta(days=1)).isoformat()
    return f" WHERE {column} >= ? AND {column} < ?", [start, end_exclusive]


def _exact_date_clause(column: str, value: str) -> tuple[str, list[str]]:
    end = (parse_date(value) + timedelta(days=1)).isoformat()
    return f" WHERE {column} >= ? AND {column} < ?", [value, end]


def _page(
    db: sqlite3.Connection,
    *,
    select_sql: str,
    count_sql: str,
    params: list[object],
    limit: int,
    offset: int,
) -> tuple[list[dict], dict[str, object]]:
    total = int(db.execute(count_sql, params).fetchone()[0])
    effective_limit = min(limit, MAX_PAGE_OFFSET - offset) if offset < MAX_PAGE_OFFSET else limit
    rows = [dict(row) for row in db.execute(
        f"{select_sql} LIMIT ? OFFSET ?", [*params, effective_limit, offset]
    ).fetchall()]
    candidate_offset = offset + len(rows)
    next_offset = (
        candidate_offset
        if candidate_offset < total and candidate_offset <= MAX_PAGE_OFFSET
        else None
    )
    truncated = next_offset is None and candidate_offset < total
    return rows, {
        "total": total,
        "returned": len(rows),
        "offset": offset,
        "next_offset": next_offset,
        "truncated": truncated,
        "pagination_note": (
            "More records exist beyond the accessible offset ceiling; narrow the date range or filter."
            if truncated
            else None
        ),
    }


def _coverage(db: sqlite3.Connection) -> dict[str, object]:
    specs = {
        "workouts": ("workout_sessions", "date"),
        "exercises": ("exercises", None),
        "sets": ("workout_sets", None),
        "nutrition": ("nutrition_entries", "date"),
        "body_composition": ("body_composition", "date"),
        "daily_health": ("daily_health", "date"),
        "google_daily_snapshots": ("google_daily_snapshots", "date"),
        "goals": ("goals", "start_date"),
        "daily_reviews": ("daily_reviews", "date"),
        "weekly_reviews": ("weekly_reviews", "week_end"),
        "trend_summaries": ("trend_summaries", "generated_at"),
    }
    domains = {}
    for name, (table, date_column) in specs.items():
        if date_column is None:
            row = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            domains[name] = {"records": int(row[0]), "earliest_date": None, "latest_date": None}
        else:
            row = db.execute(
                f"SELECT COUNT(*), MIN({date_column}), MAX({date_column}) FROM {table}"
            ).fetchone()
            domains[name] = {
                "records": int(row[0]), "earliest_date": row[1], "latest_date": row[2]
            }
    connections = []
    for row in db.execute("SELECT * FROM source_connections ORDER BY provider"):
        item = dict(row)
        item["connected"] = bool(item["connected"])
        connections.append(item)
    owned = int(db.execute("SELECT COUNT(*) FROM health_connect_ownership").fetchone()[0])
    today = owner_today()
    journey_row = db.execute(
        "SELECT COUNT(*),MIN(date),MAX(date),SUM(energy IS NOT NULL),"
        "SUM(soreness IS NOT NULL),SUM(stress IS NOT NULL),MAX(updated_at) "
        "FROM journey_days WHERE date<=?", (today,),
    ).fetchone()
    preferences_present = bool(db.execute("SELECT COUNT(*) FROM journey_preferences").fetchone()[0])
    text_exposure = dict(db.execute("SELECT key,value FROM metadata"))["journey_text"]
    return {
        **_metadata(db),
        "schema_version": SCHEMA_VERSION,
        "domains": domains,
        "journey": {
            "days": int(journey_row[0]),
            "earliest_date": journey_row[1],
            "latest_date": journey_row[2],
            "rated_days": {
                "energy": int(journey_row[3] or 0),
                "soreness": int(journey_row[4] or 0),
                "stress": int(journey_row[5] or 0),
            },
            "preferences_present": preferences_present,
            "last_updated_at": journey_row[6],
            "text_exposure": text_exposure,
        },
        "source_connections": connections,
        "health_connect_owned_days": owned,
        "source_semantics": (
            "daily_health is GainLog's reconciled canonical row with a row-level effective source; "
            "it does not claim per-metric provenance. google_snapshot is the persisted Google-owned "
            "source snapshot before reconciliation. Missing is null and observed zero remains zero."
        ),
        "omissions": {
            "credentials": "not_exported",
            "oauth_state": "not_exported",
            "raw_provider_payloads": "not_exported",
            "nutrition_sync_events": "not_exported",
            "regeneration_and_sync": "unsupported",
            "writes": "unsupported",
            "arbitrary_sql_paths_urls": "unsupported",
        },
    }


def _list_workouts(db: sqlite3.Connection, request: ListWorkoutsRequest) -> dict[str, object]:
    where, params = _date_clause("w.date", request.start_date, request.end_date)
    select_sql = f"""
        SELECT w.*,
               (SELECT COUNT(*) FROM exercises e WHERE e.session_id=w.id) AS exercise_count,
               (SELECT COUNT(*) FROM workout_sets s JOIN exercises e ON e.id=s.exercise_id
                 WHERE e.session_id=w.id) AS set_count
          FROM workout_sessions w{where} ORDER BY w.date DESC, w.id
    """
    count_sql = f"SELECT COUNT(*) FROM workout_sessions w{where}"
    items, page = _page(db, select_sql=select_sql, count_sql=count_sql, params=params,
                        limit=request.limit, offset=request.offset)
    for item in items:
        item["pain"] = bool(item["pain"])
        item["coach_insight_json"] = item.pop("insight_json")
    return {**_metadata(db), **page, "items": items}


def _get_workout(db: sqlite3.Connection, request: GetWorkoutRequest) -> dict[str, object]:
    if request.session_id is None:
        row = db.execute("SELECT * FROM workout_sessions ORDER BY date DESC, id LIMIT 1").fetchone()
    else:
        row = db.execute("SELECT * FROM workout_sessions WHERE id=?", (request.session_id,)).fetchone()
    if row is None:
        return {"error": "not_found"}
    workout = dict(row)
    workout["pain"] = bool(workout["pain"])
    workout["coach_insight_json"] = workout.pop("insight_json")
    exercises = []
    for exercise_row in db.execute(
        "SELECT * FROM exercises WHERE session_id=? ORDER BY id", (workout["id"],)
    ):
        exercise = dict(exercise_row)
        exercise.pop("session_id")
        exercise["sets"] = [dict(set_row) for set_row in db.execute(
            "SELECT id,reps,weight FROM workout_sets WHERE exercise_id=? ORDER BY id",
            (exercise["id"],),
        )]
        exercises.append(exercise)
    workout["exercises"] = exercises
    return {**_metadata(db), "workout": workout}


def _generic_entries(
    db: sqlite3.Connection,
    *,
    table: str,
    request,
    id_column: str,
) -> dict[str, object]:
    if request.entry_id is not None:
        where, params = f" WHERE {id_column}=?", [request.entry_id]
    else:
        where, params = _date_clause("date", request.start_date, request.end_date)
    items, page = _page(
        db,
        select_sql=f"SELECT * FROM {table}{where} ORDER BY date DESC, {id_column}",
        count_sql=f"SELECT COUNT(*) FROM {table}{where}",
        params=params,
        limit=request.limit,
        offset=request.offset,
    )
    if request.entry_id is not None and not items:
        return {"error": "not_found"}
    return {**_metadata(db), **page, "items": items}


def _daily_health(db: sqlite3.Connection, request: DailyHealthRequest) -> dict[str, object]:
    if request.dataset == "canonical":
        table = "daily_health"
        source_expression = "source"
        updated_expression = "updated_at"
        stand_expression = "stand_hours"
        source_note = "Canonical reconciled GainLog rows; source is row-level, not per-metric provenance."
    else:
        table = "google_daily_snapshots"
        source_expression = "'google-health-snapshot'"
        updated_expression = "source_updated_at"
        stand_expression = "NULL"
        source_note = "Persisted Google-owned snapshots before canonical reconciliation."
    if request.date is not None:
        where, params = _exact_date_clause("date", request.date)
    else:
        where, params = _date_clause("date", request.start_date, request.end_date)
    fields = f"""
      '{request.dataset}' AS dataset, date, sleep_minutes, deep_sleep_minutes,
      core_sleep_minutes, rem_sleep_minutes, awake_minutes, resting_heart_rate_bpm,
      hrv_ms, steps, active_calories, total_calories, exercise_minutes,
      {stand_expression} AS stand_hours, walking_running_miles,
      {source_expression} AS source, {updated_expression} AS updated_at
    """
    items, page = _page(
        db, select_sql=f"SELECT {fields} FROM {table}{where} ORDER BY date DESC",
        count_sql=f"SELECT COUNT(*) FROM {table}{where}", params=params,
        limit=request.limit, offset=request.offset,
    )
    return {**_metadata(db), **page, "items": items, "source_note": source_note}


def _goals(db: sqlite3.Connection, request: GoalsRequest) -> dict[str, object]:
    if request.goal_id is not None:
        where, params = " WHERE id=?", [request.goal_id]
    elif request.status is not None:
        where, params = " WHERE status=?", [request.status]
    else:
        where, params = "", []
    items, page = _page(
        db, select_sql=f"SELECT * FROM goals{where} ORDER BY start_date DESC,id",
        count_sql=f"SELECT COUNT(*) FROM goals{where}", params=params,
        limit=request.limit, offset=request.offset,
    )
    if request.goal_id is not None and not items:
        return {"error": "not_found"}
    return {**_metadata(db), **page, "items": items}


def _reviews(db: sqlite3.Connection, request: ReviewsRequest) -> dict[str, object]:
    if request.kind == "daily":
        table, date_column, key_column = "daily_reviews", "date", "date"
        select = "'daily' kind,date key,date,NULL week_start,NULL week_end,NULL category,NULL metric,NULL range,review text,NULL model,generated_at"
    elif request.kind == "weekly":
        table, date_column, key_column = "weekly_reviews", "week_end", "week_end"
        select = "'weekly' kind,week_end key,NULL date,week_start,week_end,NULL category,NULL metric,NULL range,review text,NULL model,generated_at"
    else:
        table, date_column, key_column = "trend_summaries", "generated_at", "cache_key"
        select = "'trend' kind,cache_key key,NULL date,NULL week_start,NULL week_end,NULL category,NULL metric,NULL range,summary text,model,generated_at"
    if request.key is not None:
        where, params = f" WHERE {key_column}=?", [request.key]
    else:
        where, params = _date_clause(date_column, request.start_date, request.end_date)
    items, page = _page(
        db, select_sql=f"SELECT {select} FROM {table}{where} ORDER BY {date_column} DESC,{key_column}",
        count_sql=f"SELECT COUNT(*) FROM {table}{where}", params=params,
        limit=request.limit, offset=request.offset,
    )
    if request.key is not None and not items:
        return {"error": "not_found"}
    if request.kind == "trend":
        for item in items:
            parts = item["key"].split(":", 3)
            if len(parts) == 4:
                item["category"], item["metric"], item["range"] = parts[:3]
    return {**_metadata(db), **page, "items": items}


def _journey_preferences(db: sqlite3.Connection) -> dict | None:
    row = db.execute(
        "SELECT revision,updated_at,wake_time,sleep_minutes,wind_down_minutes,"
        "focus weekly_focus FROM journey_preferences WHERE id='default'"
    ).fetchone()
    return dict(row) if row is not None else None


def _journey_row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    item = dict(row)
    item["nutrition_reviewed"] = bool(item["nutrition_reviewed"])
    return item


def _journey(db: sqlite3.Connection, request: JourneyRequest) -> dict[str, object]:
    params: list[object]
    if request.start_date is not None:
        where, date_params = _date_clause("date", request.start_date, request.end_date)
        params = list(date_params)
    else:
        where, params = " WHERE date <= ?", []
        params.append(owner_today())
    items, page = _page(
        db,
        select_sql=f"SELECT * FROM journey_days{where} ORDER BY date DESC",
        count_sql=f"SELECT COUNT(*) FROM journey_days{where}",
        params=params,
        limit=request.limit,
        offset=request.offset,
    )
    for item in items:
        item["nutrition_reviewed"] = bool(item["nutrition_reviewed"])
    return {
        **_metadata(db), **page, "items": items,
        "current_preferences": _journey_preferences(db), "semantics": JOURNEY_SEMANTICS,
    }


def _latest_context_date(db: sqlite3.Connection) -> str:
    today = owner_today()
    row = db.execute(
        "SELECT MAX(value) FROM ("
        "SELECT MAX(date) value FROM journey_days WHERE date<=? UNION ALL "
        "SELECT MAX(date) FROM daily_health WHERE date<=? UNION ALL "
        "SELECT MAX(substr(date,1,10)) FROM workout_sessions WHERE date<=?||'T23:59:59' UNION ALL "
        "SELECT MAX(substr(date,1,10)) FROM nutrition_entries WHERE date<=?||'T23:59:59'"
        ")", (today, today, today, today),
    ).fetchone()
    return row[0] or today


def _day_context(db: sqlite3.Connection, request: DayContextRequest) -> dict[str, object]:
    selected = request.date or _latest_context_date(db)
    health_row = db.execute(
        "SELECT 'canonical' dataset,date,sleep_minutes,deep_sleep_minutes,core_sleep_minutes,"
        "rem_sleep_minutes,awake_minutes,resting_heart_rate_bpm,hrv_ms,steps,active_calories,"
        "total_calories,exercise_minutes,stand_hours,walking_running_miles,source,updated_at "
        "FROM daily_health WHERE date=?", (selected,),
    ).fetchone()
    journey = _journey_row(db.execute("SELECT * FROM journey_days WHERE date=?", (selected,)).fetchone())
    start, end = selected, (parse_date(selected) + timedelta(days=1)).isoformat()
    workouts = [dict(row) for row in db.execute(
        "SELECT w.*,(SELECT COUNT(*) FROM exercises e WHERE e.session_id=w.id) exercise_count,"
        "(SELECT COUNT(*) FROM workout_sets s JOIN exercises e ON e.id=s.exercise_id "
        "WHERE e.session_id=w.id) set_count FROM workout_sessions w "
        "WHERE w.date>=? AND w.date<? ORDER BY w.date,w.id LIMIT 50", (start, end),
    )]
    for workout in workouts:
        workout["pain"] = bool(workout["pain"])
        workout["coach_insight_json"] = workout.pop("insight_json")
    nutrition_row = db.execute(
        "SELECT COUNT(*),SUM(calories),SUM(protein_g),SUM(carbs_g),SUM(fat_g),SUM(fiber_g) "
        "FROM nutrition_entries WHERE date>=? AND date<?", (start, end),
    ).fetchone()
    nutrition = None if nutrition_row[0] == 0 else dict(zip(
        ("entry_count", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g"),
        nutrition_row,
    ))
    current_preferences = _journey_preferences(db)
    coverage = {
        "daily_health": health_row is not None,
        "workouts": bool(workouts),
        "nutrition": nutrition is not None,
        "journey": journey is not None,
        "preferences": current_preferences is not None,
    }
    return {
        **_metadata(db), "date": selected,
        "daily_health": dict(health_row) if health_row is not None else None,
        "workouts": workouts, "nutrition": nutrition, "journey": journey,
        "current_preferences": current_preferences, "semantics": JOURNEY_SEMANTICS,
        "coverage": coverage,
    }


def query(path: Path, name: str, arguments: object) -> dict[str, object]:
    try:
        request_type = REQUESTS.get(name)
        if request_type is None or type(arguments) is not dict:
            return {"error": "invalid_request"}
        request = request_type.model_validate(arguments, strict=True)
        with open_store(Path(path)) as db:
            if name == "get_data_coverage":
                return _coverage(db)
            if name == "list_workouts":
                return _list_workouts(db, request)
            if name == "get_workout":
                return _get_workout(db, request)
            if name == "query_nutrition":
                return _generic_entries(db, table="nutrition_entries", request=request, id_column="id")
            if name == "query_body_composition":
                return _generic_entries(db, table="body_composition", request=request, id_column="id")
            if name == "query_daily_health":
                return _daily_health(db, request)
            if name == "query_goals":
                return _goals(db, request)
            if name == "query_saved_reviews":
                return _reviews(db, request)
            if name == "get_journey":
                return _journey(db, request)
            if name == "get_day_context":
                return _day_context(db, request)
        return {"error": "invalid_request"}
    except ValidationError:
        return {"error": "invalid_request"}
    except StoreError as exc:
        return {"error": str(exc)}
    except Exception:
        return {"error": "invalid_request"}
