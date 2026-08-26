"""Server-only OAuth and reconciliation primitives for Google Health v4."""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet, InvalidToken

GOOGLE_HEALTH_SCOPES = (
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
)
GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_HEALTH_CALLBACK_URL = (
    "https://gainlog-api.tailc88c35.ts.net/integrations/google-health/oauth/callback"
)
GOOGLE_HEALTH_API = "https://health.googleapis.com/v4"
GOOGLE_WEARABLES = "users/me/dataSourceFamilies/google-wearables"
GOOGLE_OWNED_FIELDS = (
    "sleep_minutes",
    "deep_sleep_minutes",
    "core_sleep_minutes",
    "rem_sleep_minutes",
    "awake_minutes",
    "resting_heart_rate_bpm",
    "hrv_ms",
    "steps",
    "active_calories",
    "total_calories",
    "exercise_minutes",
    "walking_running_miles",
)
_INT64_MAX = 9_223_372_036_854_775_807


class GoogleHealthConfigurationError(RuntimeError):
    pass


class GoogleHealthDataError(ValueError):
    pass


class GoogleHealthAuthorizationError(GoogleHealthDataError):
    pass


class TokenCipher:
    def __init__(self, key: str):
        try:
            self._fernet = Fernet(key.encode())
        except (ValueError, TypeError) as exc:
            raise GoogleHealthConfigurationError(
                "Google Health token encryption is unavailable"
            ) from exc

    def encrypt(self, token: str) -> str:
        return self._fernet.encrypt(token.encode()).decode()

    def decrypt(self, encrypted_token: str) -> str:
        try:
            return self._fernet.decrypt(encrypted_token.encode()).decode()
        except (InvalidToken, ValueError, TypeError) as exc:
            raise GoogleHealthConfigurationError(
                "Stored Google Health credential is unavailable"
            ) from exc


def require_google_health_config() -> tuple[str, str, TokenCipher]:
    client_id = os.environ.get("GAINLOG_GOOGLE_HEALTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GAINLOG_GOOGLE_HEALTH_CLIENT_SECRET", "").strip()
    key = os.environ.get("GAINLOG_GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY", "").strip()
    if not client_id or not client_secret or not key:
        raise GoogleHealthConfigurationError(
            "Google Health integration is not configured"
        )
    return client_id, client_secret, TokenCipher(key)


def new_pkce_verifier() -> str:
    return secrets.token_urlsafe(64)


def pkce_challenge(verifier: str) -> str:
    return (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )


def build_authorization_url(
    state: str,
    client_id: str,
    verifier: str | None = None,
) -> tuple[str, str]:
    verifier = verifier or new_pkce_verifier()
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": GOOGLE_HEALTH_CALLBACK_URL,
            "response_type": "code",
            "scope": " ".join(GOOGLE_HEALTH_SCOPES),
            "state": state,
            "code_challenge": pkce_challenge(verifier),
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
        },
        quote_via=quote,
    )
    return f"{GOOGLE_AUTHORIZATION_URL}?{query}", verifier


def _int64(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise GoogleHealthDataError(f"{field} must be a nonnegative int64")
    if isinstance(value, str) and not value.isdecimal():
        raise GoogleHealthDataError(f"{field} must be a nonnegative int64")
    parsed = int(value)
    if parsed < 0 or parsed > _INT64_MAX:
        raise GoogleHealthDataError(f"{field} must be a nonnegative int64")
    return parsed


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GoogleHealthDataError(f"{field} must be a nonnegative number")
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0:
        raise GoogleHealthDataError(f"{field} must be a nonnegative number")
    return parsed


def _date_from_google(value: Any) -> str | None:
    """Parse either google.type.Date or CivilDateTime.date."""
    if not isinstance(value, dict):
        return None
    if "date" in value:
        value = value.get("date")
    if not isinstance(value, dict):
        return None
    try:
        return date(
            int(value["year"]),
            int(value["month"]),
            int(value["day"]),
        ).isoformat()
    except (KeyError, TypeError, ValueError):
        return None


def parse_sleep_summary(record: dict[str, Any]) -> dict[str, int | str | None]:
    minutes = _int64(
        record.get("minutesAsleep"),
        "sleep summary minutesAsleep",
    )
    end_time = record.get("endTime")
    if not isinstance(end_time, str):
        raise GoogleHealthDataError("sleep summary is missing endTime")
    try:
        end_date = datetime.fromisoformat(
            end_time.replace("Z", "+00:00")
        ).date().isoformat()
    except ValueError as exc:
        raise GoogleHealthDataError("sleep summary has invalid endTime") from exc

    stages: dict[str, int] = {}
    stage_items = record.get("stagesSummary", [])
    if not isinstance(stage_items, list):
        raise GoogleHealthDataError("sleep stages summary must be a list")
    for item in stage_items:
        if not isinstance(item, dict):
            continue
        stage = item.get("type", item.get("stageType"))
        if stage not in {"LIGHT", "DEEP", "REM", "AWAKE"}:
            continue
        parsed = _int64(item.get("minutes"), f"sleep stage {stage} minutes")
        if stage in stages and stages[stage] != parsed:
            raise GoogleHealthDataError(
                f"conflicting duplicate sleep stage: {stage}"
            )
        stages[stage] = parsed

    awake = (
        _int64(record["minutesAwake"], "sleep summary minutesAwake")
        if "minutesAwake" in record
        else stages.get("AWAKE")
    )
    if awake is not None and "AWAKE" in stages and awake != stages["AWAKE"]:
        raise GoogleHealthDataError("conflicting awake sleep summaries")

    return {
        "date": end_date,
        "sleep_minutes": minutes,
        "core_sleep_minutes": stages.get("LIGHT"),
        "deep_sleep_minutes": stages.get("DEEP"),
        "rem_sleep_minutes": stages.get("REM"),
        "awake_minutes": awake,
    }


def _is_processed_main_sleep(point: dict[str, Any]) -> bool:
    sleep = point.get("sleep")
    if not isinstance(sleep, dict):
        return False
    metadata = sleep.get("metadata")
    return bool(
        isinstance(metadata, dict)
        and metadata.get("mainSleep") is True
        and metadata.get("processed") is True
        and metadata.get("nap") is not True
    )


def parse_reconciled_sleep(
    record: dict[str, Any],
) -> dict[str, int | str | None]:
    sleep = record.get("sleep")
    if not isinstance(sleep, dict):
        raise GoogleHealthDataError("reconciled point has no sleep payload")
    if not _is_processed_main_sleep(record):
        raise GoogleHealthDataError("sleep is not a processed main sleep")

    summary = sleep.get("summary")
    interval = sleep.get("interval")
    if not isinstance(summary, dict) or not isinstance(interval, dict):
        raise GoogleHealthDataError("sleep is missing summary or interval")

    parsed = parse_sleep_summary({**summary, "endTime": interval.get("endTime")})
    civil_end_date = _date_from_google(interval.get("civilEndTime"))
    if civil_end_date is not None:
        parsed["date"] = civil_end_date
    return parsed


def google_health_sync_range(
    start_date: str | None = None,
    end_date: str | None = None,
    *,
    backfill: bool = False,
    today: date | None = None,
) -> tuple[str, str]:
    today = today or date.today()
    if start_date is None and end_date is None:
        end = today + timedelta(days=1)
        start = today - timedelta(days=6)
    elif not start_date or not end_date:
        raise ValueError("start_date and end_date must be provided together")
    else:
        try:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
        except ValueError as exc:
            raise ValueError("dates must use YYYY-MM-DD") from exc
        if start.isoformat() != start_date or end.isoformat() != end_date:
            raise ValueError("dates must use YYYY-MM-DD")

    maximum_days = 366 if backfill else 14
    if end <= start or (end - start).days > maximum_days:
        raise ValueError("Google Health sync range is invalid or too large")
    return start.isoformat(), end.isoformat()


def _duration_minutes(value: Any) -> int | None:
    if not isinstance(value, str) or not value.endswith("s"):
        return None
    try:
        seconds = float(value[:-1])
    except ValueError:
        return None
    if not math.isfinite(seconds) or seconds < 0:
        return None
    return int(seconds // 60)


def _date_payload(value: date) -> dict[str, int]:
    return {"year": value.year, "month": value.month, "day": value.day}


def _response_json(response: Any, *, authorization: bool = False) -> dict[str, Any]:
    if not getattr(response, "ok", False):
        status = getattr(response, "status_code", None)
        if authorization and status in {400, 401}:
            raise GoogleHealthAuthorizationError(
                "Google Health authorization needs reconnection"
            )
        raise GoogleHealthDataError("Google Health data request failed")
    try:
        payload = response.json()
    except Exception as exc:
        raise GoogleHealthDataError("Google Health returned invalid data") from exc
    if not isinstance(payload, dict):
        raise GoogleHealthDataError("Google Health returned invalid data")
    return payload


def _rollup_config() -> tuple[
    tuple[str, str, str, str, Callable[[Any], int | float], int], ...
]:
    return (
        (
            "steps",
            "steps",
            "countSum",
            "steps",
            lambda value: _int64(value, "steps"),
            90,
        ),
        (
            "distance",
            "distance",
            "millimetersSum",
            "walking_running_miles",
            lambda value: _int64(value, "distance") / 1_609_344.0,
            90,
        ),
        (
            "active-energy-burned",
            "activeEnergyBurned",
            "kcalSum",
            "active_calories",
            lambda value: _number(value, "active calories"),
            90,
        ),
        (
            "total-calories",
            "totalCalories",
            "kcalSum",
            "total_calories",
            lambda value: _number(value, "total calories"),
            14,
        ),
    )


def _collect_rollups(
    http: Any,
    headers: dict[str, str],
    days: dict[str, dict[str, int | float]],
) -> None:
    day_keys = sorted(days)
    for kind, union_field, value_field, target_field, convert, chunk_size in (
        _rollup_config()
    ):
        for offset in range(0, len(day_keys), chunk_size):
            chunk = day_keys[offset : offset + chunk_size]
            chunk_start = date.fromisoformat(chunk[0])
            chunk_end = date.fromisoformat(chunk[-1]) + timedelta(days=1)
            body = {
                "range": {
                    "start": {"date": _date_payload(chunk_start)},
                    "end": {"date": _date_payload(chunk_end)},
                },
                "dataSourceFamily": GOOGLE_WEARABLES,
                "windowSizeDays": 1,
            }
            response = http.post(
                f"{GOOGLE_HEALTH_API}/users/me/dataTypes/{kind}/dataPoints:dailyRollUp",
                headers=headers,
                json=body,
                timeout=20,
            )
            payload = _response_json(response)
            points = payload.get("rollupDataPoints", [])
            if not isinstance(points, list):
                raise GoogleHealthDataError("Google Health returned invalid rollup data")
            for point in points:
                if not isinstance(point, dict):
                    continue
                day = _date_from_google(point.get("civilStartTime"))
                if day not in days:
                    continue
                value = point.get(union_field)
                if not isinstance(value, dict) or value_field not in value:
                    continue
                days[day][target_field] = convert(value[value_field])


def _iter_reconciled_points(
    http: Any,
    headers: dict[str, str],
    *,
    kind: str,
    filter_field: str,
    start: str,
    end: str,
):
    base_params: dict[str, Any] = {
        "dataSourceFamily": GOOGLE_WEARABLES,
        "pageSize": 25 if kind in {"sleep", "exercise"} else 10_000,
        "filter": f'{filter_field} >= "{start}" AND {filter_field} < "{end}"',
    }
    page_token: str | None = None
    seen_tokens: set[str] = set()
    while True:
        params = dict(base_params)
        if page_token is not None:
            params["pageToken"] = page_token
        response = http.get(
            f"{GOOGLE_HEALTH_API}/users/me/dataTypes/{kind}/dataPoints:reconcile",
            headers=headers,
            params=params,
            timeout=20,
        )
        payload = _response_json(response)
        points = payload.get("dataPoints", [])
        if not isinstance(points, list):
            raise GoogleHealthDataError(
                "Google Health returned invalid reconciled data"
            )
        for point in points:
            if isinstance(point, dict):
                yield point

        token = payload.get("nextPageToken")
        if token in {None, ""}:
            return
        if not isinstance(token, str) or token in seen_tokens:
            raise GoogleHealthDataError("Google Health pagination is invalid")
        seen_tokens.add(token)
        page_token = token


def _collect_reconciled_data(
    http: Any,
    headers: dict[str, str],
    *,
    start: str,
    end: str,
    days: dict[str, dict[str, int | float]],
) -> None:
    sleep_candidates: dict[str, dict[str, int | str | None]] = {}
    for point in _iter_reconciled_points(
        http,
        headers,
        kind="sleep",
        filter_field="sleep.interval.civil_end_time",
        start=start,
        end=end,
    ):
        if not _is_processed_main_sleep(point):
            continue
        parsed = parse_reconciled_sleep(point)
        day = parsed["date"]
        if not isinstance(day, str) or day not in days:
            continue
        existing = sleep_candidates.get(day)
        if existing is not None and existing != parsed:
            raise GoogleHealthDataError(
                f"conflicting processed main sleeps for {day}"
            )
        sleep_candidates[day] = parsed

    for day, parsed in sleep_candidates.items():
        for field, value in parsed.items():
            if field != "date" and isinstance(value, (int, float)):
                days[day][field] = value

    for point in _iter_reconciled_points(
        http,
        headers,
        kind="daily-heart-rate-variability",
        filter_field="daily_heart_rate_variability.date",
        start=start,
        end=end,
    ):
        value = point.get("dailyHeartRateVariability")
        if not isinstance(value, dict):
            continue
        day = _date_from_google(value.get("date"))
        hrv = value.get("averageHeartRateVariabilityMilliseconds")
        if day in days and hrv is not None:
            days[day]["hrv_ms"] = _number(hrv, "heart rate variability")

    for point in _iter_reconciled_points(
        http,
        headers,
        kind="daily-resting-heart-rate",
        filter_field="daily_resting_heart_rate.date",
        start=start,
        end=end,
    ):
        value = point.get("dailyRestingHeartRate")
        if not isinstance(value, dict):
            continue
        day = _date_from_google(value.get("date"))
        if day not in days or "beatsPerMinute" not in value:
            continue
        beats = _int64(value["beatsPerMinute"], "resting heart rate")
        if beats < 20 or beats > 250:
            raise GoogleHealthDataError("resting heart rate is outside valid bounds")
        days[day]["resting_heart_rate_bpm"] = float(beats)

    seen_exercises: set[str] = set()
    exercise_query_start = (
        date.fromisoformat(start) - timedelta(days=1)
    ).isoformat()
    for point in _iter_reconciled_points(
        http,
        headers,
        kind="exercise",
        filter_field="exercise.interval.civil_start_time",
        start=exercise_query_start,
        end=end,
    ):
        value = point.get("exercise")
        if not isinstance(value, dict):
            continue
        identity = point.get("dataPointName")
        if not isinstance(identity, str) or not identity:
            identity = json.dumps(value, sort_keys=True, separators=(",", ":"))
        if identity in seen_exercises:
            continue
        seen_exercises.add(identity)

        interval = value.get("interval")
        if not isinstance(interval, dict):
            continue
        day = _date_from_google(interval.get("civilEndTime"))
        minutes = _duration_minutes(value.get("activeDuration"))
        if day not in days or minutes is None:
            continue
        days[day]["exercise_minutes"] = (
            int(days[day].get("exercise_minutes", 0)) + minutes
        )


def sync_google_health(
    db: Any,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    backfill: bool = False,
    http: Any = None,
) -> dict[str, Any]:
    """Reconcile a bounded date range and persist only usable Google values."""
    try:
        from .main import (
            AppleHealthDailyDB,
            GoogleHealthConnectionDB,
            GoogleHealthDailySnapshotDB,
        )
    except ImportError:
        from main import (  # type: ignore[no-redef]
            AppleHealthDailyDB,
            GoogleHealthConnectionDB,
            GoogleHealthDailySnapshotDB,
        )

    if http is None:
        import requests

        http = requests

    start, end = google_health_sync_range(
        start_date,
        end_date,
        backfill=backfill,
    )
    connection = db.get(GoogleHealthConnectionDB, "primary")
    if (
        not connection
        or connection.status != "connected"
        or not connection.encrypted_refresh_token
    ):
        raise GoogleHealthDataError("Google Health is not connected")

    now = datetime.now(timezone.utc).isoformat()
    connection.last_attempt_at = now
    connection.last_sync_start = start
    connection.last_sync_end = end
    db.add(connection)
    db.commit()

    try:
        client_id, client_secret, cipher = require_google_health_config()
        refreshed = http.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": cipher.decrypt(
                    connection.encrypted_refresh_token
                ),
            },
            timeout=15,
        )
        token_payload = _response_json(refreshed, authorization=True)
        access_token = token_payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleHealthAuthorizationError(
                "Google Health authorization needs reconnection"
            )

        headers = {"Authorization": f"Bearer {access_token}"}
        start_value = date.fromisoformat(start)
        end_value = date.fromisoformat(end)
        days: dict[str, dict[str, int | float]] = {
            (start_value + timedelta(days=offset)).isoformat(): {}
            for offset in range((end_value - start_value).days)
        }
        _collect_rollups(http, headers, days)
        _collect_reconciled_data(
            http,
            headers,
            start=start,
            end=end,
            days=days,
        )

        reconciled_days: dict[
            str,
            tuple[dict[str, int | float], Any | None],
        ] = {}
        for day, values in days.items():
            prior_snapshot = db.get(GoogleHealthDailySnapshotDB, day)
            if values or prior_snapshot is not None:
                reconciled_days[day] = (values, prior_snapshot)

        for day, (values, prior_snapshot) in reconciled_days.items():
            previous_values = {
                field: getattr(prior_snapshot, field, None)
                for field in GOOGLE_OWNED_FIELDS
            }
            snapshot = prior_snapshot or GoogleHealthDailySnapshotDB(
                date=day,
                source_updated_at=now,
            )
            for field in GOOGLE_OWNED_FIELDS:
                setattr(snapshot, field, values.get(field))

            has_google_values = any(
                getattr(snapshot, field) is not None
                for field in GOOGLE_OWNED_FIELDS
            )
            if has_google_values:
                snapshot.source_updated_at = now
                db.add(snapshot)
            elif prior_snapshot is not None:
                db.delete(prior_snapshot)

            existing = db.get(AppleHealthDailyDB, day)
            if existing is None and values:
                existing = AppleHealthDailyDB(
                    date=day,
                    source="google-health",
                    updated_at=now,
                )
            if existing is None:
                continue

            changed = False
            for field in GOOGLE_OWNED_FIELDS:
                current_value = values.get(field)
                if current_value is not None or previous_values[field] is not None:
                    setattr(existing, field, current_value)
                    changed = True
            if not changed:
                continue

            has_daily_values = any(
                getattr(existing, field) is not None
                for field in (*GOOGLE_OWNED_FIELDS, "stand_hours")
            )
            if not has_daily_values:
                db.delete(existing)
                continue

            existing.source = (
                "google-health"
                if has_google_values
                else "health-connect"
            )
            existing.updated_at = now
            db.add(existing)

        connection.last_success_at = now
        connection.last_error = None
        connection.last_sync_count = len(reconciled_days)
        connection.status = "connected"
        db.add(connection)
        db.commit()
        return {
            "synced_days": len(reconciled_days),
            "start_date": start,
            "end_date": end,
        }
    except Exception as exc:
        db.rollback()
        connection = db.get(GoogleHealthConnectionDB, "primary")
        if connection:
            if isinstance(exc, GoogleHealthAuthorizationError):
                connection.status = "needs_reauthorization"
                connection.last_error = (
                    "Google Health authorization needs reconnection"
                )
            else:
                connection.last_error = "Google Health synchronization failed"
            db.add(connection)
            db.commit()
        raise GoogleHealthDataError(
            "Google Health synchronization failed"
        ) from exc
