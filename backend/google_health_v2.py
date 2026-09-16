"""Streaming, additive Google Health V2 shadow importer.

The legacy daily-health pipeline remains authoritative. This module preserves
provider fidelity page-by-page and never returns health payloads to callers.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import resource
import time
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Session, SQLModel, select

try:
    from .google_health import (
        GOOGLE_HEALTH_API,
        GOOGLE_TOKEN_URL,
        GoogleHealthAuthorizationError,
        GoogleHealthDataError,
        _response_json,
        require_google_health_config,
    )
    from .health_v2_models import (
        HealthDailyMetricDB,
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthImportRunDB,
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSampleObservationDB,
        HealthSleepEventDB,
        HealthSleepSessionDB,
        HealthSleepStageDB,
        HealthSourceDB,
    )
except ImportError:
    # Production deploys backend/ as a flat module root.
    from google_health import (
        GOOGLE_HEALTH_API,
        GOOGLE_TOKEN_URL,
        GoogleHealthAuthorizationError,
        GoogleHealthDataError,
        _response_json,
        require_google_health_config,
    )
    from health_v2_models import (
        HealthDailyMetricDB,
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthImportRunDB,
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSampleObservationDB,
        HealthSleepEventDB,
        HealthSleepSessionDB,
        HealthSleepStageDB,
        HealthSourceDB,
    )

GOOGLE_WEARABLES = "users/me/dataSourceFamilies/google-wearables"
GOOGLE_ALL_SOURCES = "users/me/dataSourceFamilies/all-sources"
PROVENANCE_RAW = "source_raw"
PROVENANCE_WEARABLES = "google_wearables_reconciled"
PROVENANCE_ALL = "google_all_sources_reconciled"
PROVENANCE_CANONICAL = "gainlog_current_canonical"
PAGE_SIZE = 1_000
MAX_PAGES_PER_ENDPOINT = 2_000
MAX_IMPORT_DAYS = 366
LOCAL_TIMEZONE = ZoneInfo("America/New_York")


class GoogleHealthV2Error(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _local_today() -> date:
    return datetime.now(LOCAL_TIMEZONE).date()


def _stable_id(namespace: str, *parts: object) -> str:
    material = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(f"{namespace}\x1e{material}".encode()).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _payload_hash(row: dict[str, Any]) -> str:
    ignored = {"payload_hash", "import_run_id", "ingested_at", "updated_at"}
    return hashlib.sha256(
        _canonical_json({key: value for key, value in row.items() if key not in ignored}).encode()
    ).hexdigest()


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _duration_seconds(value: Any) -> float | None:
    if not isinstance(value, str) or not value.endswith("s"):
        return None
    return _finite_number(value[:-1])


def _normalize_instant(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _civil_date(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("date"), dict):
        value = value["date"]
    try:
        return date(int(value["year"]), int(value["month"]), int(value["day"])).isoformat()
    except (KeyError, TypeError, ValueError):
        return None


def _local_date(civil: Any, instant: str | None, offset_seconds: int | None) -> str | None:
    day = _civil_date(civil)
    if day is not None:
        return day
    if instant is None:
        return None
    try:
        parsed = datetime.fromisoformat(instant.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed + timedelta(seconds=offset_seconds or 0)).date().isoformat()


def _provider_point_id(point: dict[str, Any]) -> str | None:
    for key in ("name", "dataPointName"):
        value = point.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _point_identity(point: dict[str, Any]) -> str:
    """Return a stable identity without collapsing distinct anonymous points."""
    return _provider_point_id(point) or f"payload:{hashlib.sha256(_canonical_json(point).encode()).hexdigest()}"


def _validate_range(start_date: str, end_date: str) -> tuple[str, str]:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError as exc:
        raise ValueError("dates must use YYYY-MM-DD") from exc
    if start.isoformat() != start_date or end.isoformat() != end_date:
        raise ValueError("dates must use YYYY-MM-DD")
    if end <= start or (end - start).days > MAX_IMPORT_DAYS:
        raise ValueError("Google Health V2 import range is invalid or too large")
    return start_date, end_date


def _db_bytes(db: Session) -> int:
    page_count = int(db.exec(text("PRAGMA page_count")).one()[0])
    page_size = int(db.exec(text("PRAGMA page_size")).one()[0])
    return page_count * page_size


def _rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def _source_values(
    point: dict[str, Any], source_family: str, observed_at: str
) -> tuple[str, dict[str, Any]]:
    raw = point.get("dataSource")
    if not isinstance(raw, dict):
        raw = {}
    application = raw.get("application") if isinstance(raw.get("application"), dict) else {}
    device = raw.get("device") if isinstance(raw.get("device"), dict) else {}
    application_id = (
        application.get("packageName")
        or application.get("googleWebClientId")
        or application.get("webClientId")
    )
    identity = {
        "sourceFamily": source_family,
        "platform": raw.get("platform"),
        "applicationId": application_id,
        "deviceName": device.get("displayName"),
        "deviceType": device.get("formFactor"),
        "deviceManufacturer": device.get("manufacturer"),
        "recordingMethod": raw.get("recordingMethod"),
    }
    source_id = _stable_id("google-health-source", _canonical_json(identity))
    return source_id, {
        "id": source_id,
        "provider": "google-health",
        "source_family": source_family,
        "platform": identity["platform"],
        "application_id": identity["applicationId"],
        "device_name": identity["deviceName"],
        "device_type": identity["deviceType"],
        "device_manufacturer": identity["deviceManufacturer"],
        "recording_method": identity["recordingMethod"],
        "provider_source_identity": _canonical_json(identity),
        "first_seen_at": observed_at,
        "last_seen_at": observed_at,
    }


def _upsert_source(db: Session, row: dict[str, Any]) -> str:
    existing = db.get(HealthSourceDB, row["id"])
    if existing is None:
        db.add(HealthSourceDB(**row))
    else:
        if row["first_seen_at"] < existing.first_seen_at:
            existing.first_seen_at = row["first_seen_at"]
        if row["last_seen_at"] > existing.last_seen_at:
            existing.last_seen_at = row["last_seen_at"]
        db.add(existing)
    return row["id"]


def _bulk_upsert(
    db: Session,
    model: type[SQLModel],
    rows: list[dict[str, Any]],
) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    # Exact duplicate anonymous records are semantically indistinguishable. Keep
    # one deterministic row so one page cannot target the same primary key twice.
    rows = list({row["id"]: row for row in rows}.values())
    ids = [row["id"] for row in rows]
    existing = {
        record_id: payload_hash
        for record_id, payload_hash in db.exec(
            select(model.id, model.payload_hash).where(model.id.in_(ids))  # type: ignore[attr-defined]
        ).all()
    }
    created = sum(1 for row in rows if row["id"] not in existing)
    changed_rows = [
        row for row in rows
        if row["id"] not in existing or existing[row["id"]] != row["payload_hash"]
    ]
    updated = len(changed_rows) - created
    unchanged = len(rows) - len(changed_rows)
    if changed_rows:
        table = model.__table__  # type: ignore[attr-defined]
        statement = sqlite_insert(table).values(changed_rows)
        update_values = {
            column.name: getattr(statement.excluded, column.name)
            for column in table.columns
            if column.name != "id"
        }
        db.exec(
            statement.on_conflict_do_update(
                index_elements=[table.c.id],
                set_=update_values,
            )
        )
    table = model.__table__  # type: ignore[attr-defined]
    if "import_run_id" in table.c:
        values: dict[str, Any] = {"import_run_id": rows[0]["import_run_id"]}
        if "is_deleted" in table.c:
            values["is_deleted"] = False
        db.exec(update(table).where(table.c.id.in_(ids)).values(**values))
    return created, updated, unchanged


class GoogleHealthV2Importer:
    def __init__(
        self,
        db: Session,
        http: Any,
        access_token: str,
        run: HealthImportRunDB,
        start: str,
        end: str,
    ) -> None:
        self.db = db
        self.http = http
        self.access_token = access_token
        self.run = run
        self.start = start
        self.end = end
        self.ingested_at = _now()
        self.counts: dict[str, dict[str, int]] = defaultdict(
            lambda: {"seen": 0, "inserted": 0, "updated": 0, "unchanged": 0}
        )
        self.pages: dict[str, int] = defaultdict(int)

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def _record_changes(
        self, key: str, seen: int, changes: Iterable[tuple[int, int, int]]
    ) -> None:
        inserted = updated = unchanged = 0
        for created, changed, same in changes:
            inserted += created
            updated += changed
            unchanged += same
        self.counts[key]["seen"] += seen
        self.counts[key]["inserted"] += inserted
        self.counts[key]["updated"] += updated
        self.counts[key]["unchanged"] += unchanged
        self.run.records_seen += seen
        self.run.records_inserted += inserted
        self.run.records_updated += updated
        self.run.records_unchanged += unchanged

    def _tombstone_missing(self, model: type[SQLModel], *conditions: Any) -> None:
        """Mark rows absent from a fully paginated endpoint window as deleted."""
        table = model.__table__  # type: ignore[attr-defined]
        self.db.exec(
            update(table)
            .where(
                *conditions,
                table.c.import_run_id != self.run.id,
                table.c.is_deleted == False,  # noqa: E712
            )
            .values(is_deleted=True)
        )
        self.db.commit()

    def _commit_page(self, key: str, page_number: int, token: Any, size: int) -> None:
        self.run.current_data_type = key
        self.run.current_page = page_number
        self.run.last_page_token_hash = (
            hashlib.sha256(token.encode()).hexdigest()
            if isinstance(token, str) and token
            else None
        )
        self.run.pages_processed += 1
        self.run.max_page_records = max(self.run.max_page_records, size)
        self.pages[key] += 1
        self.run.counts_json = _canonical_json(self.counts)
        self.run.pages_json = _canonical_json(self.pages)
        self.run.peak_memory_kb = _rss_kb()
        self.db.add(self.run)
        self.db.commit()

    def _get_page(self, endpoint: str, params: dict[str, Any]) -> Any:
        """Retry bounded transient transport/API failures without logging payloads."""
        last_exception: Exception | None = None
        for attempt in range(4):
            try:
                response = self.http.get(
                    endpoint,
                    headers=self.headers,
                    params=params,
                    timeout=30,
                )
                self.run.api_calls += 1
            except Exception as exc:
                last_exception = exc
                if attempt == 3:
                    raise GoogleHealthDataError("Google Health transport failed after retries") from exc
                time.sleep(2**attempt)
                continue
            status = getattr(response, "status_code", None)
            if status not in {429, 500, 502, 503, 504} or attempt == 3:
                return response
            retry_after = getattr(response, "headers", {}).get("Retry-After")
            try:
                if retry_after is None:
                    raise ValueError
                delay = min(max(float(retry_after), 0.0), 60.0)
            except (TypeError, ValueError):
                delay = float(2**attempt)
            time.sleep(delay)
        raise GoogleHealthDataError("Google Health transport failed after retries") from last_exception

    def pages_for(
        self,
        *,
        kind: str,
        filter_field: str,
        source_family: str | None,
        query_start: str | None = None,
        query_end: str | None = None,
    ):
        key = f"{kind}:{source_family or 'raw'}"
        base_params: dict[str, Any] = {
            "pageSize": PAGE_SIZE,
            "filter": (
                f'{filter_field} >= "{query_start or self.start}" '
                f'AND {filter_field} < "{query_end or self.end}"'
            ),
        }
        endpoint = f"{GOOGLE_HEALTH_API}/users/me/dataTypes/{kind}/dataPoints"
        if source_family:
            endpoint += ":reconcile"
            base_params["dataSourceFamily"] = source_family
        page_token: str | None = None
        seen_tokens: set[str] = set()
        for page_number in range(1, MAX_PAGES_PER_ENDPOINT + 1):
            params = dict(base_params)
            if page_token:
                params["pageToken"] = page_token
            response = self._get_page(endpoint, params)
            payload = _response_json(response)
            points = payload.get("dataPoints", [])
            if not isinstance(points, list):
                raise GoogleHealthDataError("Google Health returned invalid data points")
            yield key, page_number, [point for point in points if isinstance(point, dict)]
            token = payload.get("nextPageToken")
            self._commit_page(key, page_number, token, len(points))
            if token in (None, ""):
                return
            if not isinstance(token, str) or token in seen_tokens:
                raise GoogleHealthDataError("Google Health pagination is invalid")
            seen_tokens.add(token)
            page_token = token
        raise GoogleHealthDataError("Google Health pagination exceeded the safety limit")

    def ingest_samples(self) -> None:
        configs = (
            ("heart-rate", "heartRate", "heart_rate", "bpm", "heart_rate.sample_time.civil_time"),
            (
                "heart-rate-variability",
                "heartRateVariability",
                "heart_rate_variability",
                "ms",
                "heart_rate_variability.sample_time.civil_time",
            ),
            (
                "oxygen-saturation",
                "oxygenSaturation",
                "oxygen_saturation",
                "percent",
                "oxygen_saturation.sample_time.civil_time",
            ),
            (
                "respiratory-rate-sleep-summary",
                "respiratoryRateSleepSummary",
                "respiratory_rate_sleep",
                "breaths/min",
                "respiratory_rate_sleep_summary.sample_time.civil_time",
            ),
        )
        for kind, union, metric, unit, filter_field in configs:
            for key, _, points in self.pages_for(
                kind=kind, filter_field=filter_field, source_family=None
            ):
                rows: list[dict[str, Any]] = []
                for point in points:
                    value = point.get(union)
                    if not isinstance(value, dict):
                        continue
                    sample_time = value.get("sampleTime")
                    if not isinstance(sample_time, dict):
                        continue
                    observed_at = _normalize_instant(sample_time.get("physicalTime"))
                    offset = _duration_seconds(sample_time.get("utcOffset"))
                    if observed_at is None:
                        continue
                    local_day = _local_date(
                        sample_time.get("civilTime"), observed_at,
                        int(offset) if offset is not None else None,
                    )
                    source_id, source = _source_values(
                        point, "raw", observed_at
                    )
                    _upsert_source(self.db, source)
                    measurements: list[tuple[str, float, str | None, dict[str, Any]]] = []
                    if kind == "heart-rate":
                        number = _finite_number(value.get("beatsPerMinute"))
                        if number is not None:
                            measurements.append((metric, number, None, value.get("metadata") or {}))
                    elif kind == "heart-rate-variability":
                        for field, suffix_name in (
                            ("rootMeanSquareOfSuccessiveDifferencesMilliseconds", "rmssd"),
                            ("standardDeviationMilliseconds", "sdnn"),
                        ):
                            number = _finite_number(value.get(field))
                            if number is not None:
                                measurements.append((f"{metric}_{suffix_name}", number, suffix_name.upper(), value.get("metadata") or {}))
                    elif kind == "oxygen-saturation":
                        number = _finite_number(value.get("percentage"))
                        if number is not None:
                            measurements.append((metric, number, None, {}))
                    else:
                        for field, category in (
                            ("fullSleepStats", "FULL_SLEEP"),
                            ("deepSleepStats", "DEEP"),
                            ("lightSleepStats", "LIGHT"),
                            ("remSleepStats", "REM"),
                        ):
                            stats = value.get(field)
                            if not isinstance(stats, dict):
                                continue
                            number = _finite_number(stats.get("breathsPerMinute"))
                            if number is not None:
                                measurements.append((metric, number, category, stats))
                    point_id = _provider_point_id(point)
                    for metric_name, number, category, metadata in measurements:
                        row = {
                            "id": _stable_id("sample", metric_name, PROVENANCE_RAW, source_id, _point_identity(point), category or ""),
                            "provider": "google-health",
                            "provider_point_id": point_id,
                            "provenance": PROVENANCE_RAW,
                            "data_type": metric_name,
                            "observed_at_utc": observed_at,
                            "utc_offset_seconds": int(offset) if offset is not None else None,
                            "local_date": local_day,
                            "numeric_value": number,
                            "unit": unit,
                            "category": category,
                            "source_id": source_id,
                            "provider_create_time": value.get("createTime"),
                            "provider_update_time": value.get("updateTime"),
                            "quality_status": None,
                            "is_deleted": False,
                            "metadata_json": _canonical_json(metadata),
                            "import_run_id": self.run.id,
                            "ingested_at": self.ingested_at,
                        }
                        row["payload_hash"] = _payload_hash(row)
                        rows.append(row)
                changes = _bulk_upsert(self.db, HealthSampleObservationDB, rows)
                self._record_changes(key, len(points), [changes])
            sample_types = {
                "heart-rate": ("heart_rate",),
                "heart-rate-variability": (
                    "heart_rate_variability_rmssd",
                    "heart_rate_variability_sdnn",
                ),
                "oxygen-saturation": ("oxygen_saturation",),
                "respiratory-rate-sleep-summary": ("respiratory_rate_sleep",),
            }[kind]
            table = HealthSampleObservationDB.__table__
            self._tombstone_missing(
                HealthSampleObservationDB,
                table.c.provenance == PROVENANCE_RAW,
                table.c.data_type.in_(sample_types),
                table.c.local_date >= self.start,
                table.c.local_date < self.end,
            )

    def _interval_rows(
        self,
        kind: str,
        union: str,
        provenance: str,
        source_family: str | None,
        points: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for point in points:
            value = point.get(union)
            if not isinstance(value, dict):
                continue
            interval = value.get("interval")
            if not isinstance(interval, dict):
                continue
            start_utc = _normalize_instant(interval.get("startTime"))
            end_utc = _normalize_instant(interval.get("endTime"))
            if start_utc is None or end_utc is None:
                continue
            start_offset = _duration_seconds(interval.get("startUtcOffset"))
            end_offset = _duration_seconds(interval.get("endUtcOffset"))
            local_day = _local_date(
                interval.get("civilStartTime"), start_utc,
                int(start_offset) if start_offset is not None else None,
            )
            source_id, source = _source_values(
                point, source_family or "raw", start_utc
            )
            _upsert_source(self.db, source)
            duration_minutes = (
                datetime.fromisoformat(end_utc.replace("Z", "+00:00"))
                - datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
            ).total_seconds() / 60.0
            measurements: list[tuple[float | None, str | None, str | None, dict[str, Any]]] = []
            if kind == "steps":
                measurements.append((_finite_number(value.get("count")), "count", None, {}))
            elif kind == "time-in-heart-rate-zone":
                measurements.append((duration_minutes, "minutes", value.get("heartRateZoneType"), {}))
            elif kind == "activity-level":
                measurements.append((duration_minutes, "minutes", value.get("activityLevelType"), {}))
            elif kind == "active-minutes":
                items = value.get("activeMinutesByActivityLevel")
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            measurements.append((_finite_number(item.get("activeMinutes")), "minutes", item.get("activityLevel"), {}))
            elif kind == "active-zone-minutes":
                measurements.append((_finite_number(value.get("activeZoneMinutes")), "minutes", value.get("heartRateZone"), {}))
            elif kind == "sedentary-period":
                measurements.append((duration_minutes, "minutes", "SEDENTARY", {}))
            point_id = _provider_point_id(point)
            for number, unit, category, metadata in measurements:
                row = {
                    "id": _stable_id("interval", kind, provenance, source_id, _point_identity(point), category or ""),
                    "provider": "google-health",
                    "provider_point_id": point_id,
                    "provenance": provenance,
                    "data_type": kind.replace("-", "_"),
                    "start_utc": start_utc,
                    "end_utc": end_utc,
                    "start_offset_seconds": int(start_offset) if start_offset is not None else None,
                    "end_offset_seconds": int(end_offset) if end_offset is not None else None,
                    "local_date": local_day,
                    "numeric_value": number,
                    "unit": unit,
                    "category": category,
                    "source_id": source_id,
                    "provider_create_time": value.get("createTime"),
                    "provider_update_time": value.get("updateTime"),
                    "quality_status": None,
                    "is_deleted": False,
                    "metadata_json": _canonical_json(metadata),
                    "import_run_id": self.run.id,
                    "ingested_at": self.ingested_at,
                }
                row["payload_hash"] = _payload_hash(row)
                rows.append(row)
        return rows

    def ingest_intervals(self) -> None:
        configs = (
            ("steps", "steps", "steps.interval.civil_start_time"),
            ("time-in-heart-rate-zone", "timeInHeartRateZone", "time_in_heart_rate_zone.interval.civil_start_time"),
            ("activity-level", "activityLevel", "activity_level.interval.civil_start_time"),
            ("active-minutes", "activeMinutes", "active_minutes.interval.civil_start_time"),
            ("active-zone-minutes", "activeZoneMinutes", "active_zone_minutes.interval.civil_start_time"),
            ("sedentary-period", "sedentaryPeriod", "sedentary_period.interval.civil_start_time"),
        )
        for kind, union, filter_field in configs:
            families: tuple[tuple[str, str | None], ...] = ((PROVENANCE_RAW, None),)
            if kind == "steps":
                families += (
                    (PROVENANCE_WEARABLES, GOOGLE_WEARABLES),
                    (PROVENANCE_ALL, GOOGLE_ALL_SOURCES),
                )
            for provenance, source_family in families:
                for key, _, points in self.pages_for(
                    kind=kind,
                    filter_field=filter_field,
                    source_family=source_family,
                ):
                    rows = self._interval_rows(
                        kind, union, provenance, source_family, points
                    )
                    changes = _bulk_upsert(self.db, HealthIntervalObservationDB, rows)
                    self._record_changes(key, len(points), [changes])
                table = HealthIntervalObservationDB.__table__
                self._tombstone_missing(
                    HealthIntervalObservationDB,
                    table.c.provenance == provenance,
                    table.c.data_type == kind.replace("-", "_"),
                    table.c.local_date >= self.start,
                    table.c.local_date < self.end,
                )

    def _sleep_rows(
        self,
        point: dict[str, Any],
        provenance: str,
        source_family: str | None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]] | None:
        value = point.get("sleep")
        if not isinstance(value, dict):
            return None
        interval = value.get("interval")
        if not isinstance(interval, dict):
            return None
        start_utc = _normalize_instant(interval.get("startTime"))
        end_utc = _normalize_instant(interval.get("endTime"))
        if start_utc is None or end_utc is None:
            return None
        start_offset = _duration_seconds(interval.get("startUtcOffset"))
        end_offset = _duration_seconds(interval.get("endUtcOffset"))
        source_id, source = _source_values(point, source_family or "raw", start_utc)
        _upsert_source(self.db, source)
        metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
        summary = value.get("summary") if isinstance(value.get("summary"), dict) else {}
        point_id = _provider_point_id(point)
        session_id = _stable_id(
            "sleep", provenance, source_id, _point_identity(point)
        )
        is_main = metadata.get("mainSleep") if isinstance(metadata.get("mainSleep"), bool) else None
        is_nap = metadata.get("nap") if isinstance(metadata.get("nap"), bool) else None
        if is_nap is None and is_main is not None:
            is_nap = not is_main
        session_kind = "NAP" if is_nap is True else "MAIN_SLEEP" if is_main is True else "SLEEP"
        session = {
            "id": session_id,
            "provider": "google-health",
            "provider_point_id": point_id,
            "provenance": provenance,
            "source_id": source_id,
            "start_utc": start_utc,
            "end_utc": end_utc,
            "start_offset_seconds": int(start_offset) if start_offset is not None else None,
            "end_offset_seconds": int(end_offset) if end_offset is not None else None,
            "local_start_date": _local_date(interval.get("civilStartTime"), start_utc, int(start_offset) if start_offset is not None else None),
            "local_end_date": _local_date(interval.get("civilEndTime"), end_utc, int(end_offset) if end_offset is not None else None),
            "session_kind": session_kind,
            "provider_sleep_type": value.get("type"),
            "is_main_sleep": is_main,
            "is_nap": is_nap,
            "processed": metadata.get("processed") if isinstance(metadata.get("processed"), bool) else None,
            "stages_status": metadata.get("stagesStatus"),
            "manually_edited": metadata.get("manuallyEdited") if isinstance(metadata.get("manuallyEdited"), bool) else None,
            "minutes_asleep": _nonnegative_int(summary.get("minutesAsleep")),
            "minutes_awake": _nonnegative_int(summary.get("minutesAwake")),
            "minutes_in_sleep_period": _nonnegative_int(summary.get("minutesInSleepPeriod")),
            "minutes_to_fall_asleep": _nonnegative_int(summary.get("minutesToFallAsleep")),
            "minutes_after_wake_up": _nonnegative_int(summary.get("minutesAfterWakeUp")),
            "stage_summary_json": _canonical_json(summary.get("stagesSummary") if isinstance(summary.get("stagesSummary"), list) else []),
            "provider_create_time": value.get("createTime"),
            "provider_update_time": value.get("updateTime"),
            "is_deleted": False,
            "metadata_json": _canonical_json(metadata),
            "import_run_id": self.run.id,
            "ingested_at": self.ingested_at,
        }
        session["payload_hash"] = _payload_hash(session)
        stages: list[dict[str, Any]] = []
        for stage in value.get("stages", []) if isinstance(value.get("stages"), list) else []:
            if not isinstance(stage, dict):
                continue
            stage_start = _normalize_instant(stage.get("startTime"))
            stage_end = _normalize_instant(stage.get("endTime"))
            stage_type = stage.get("type")
            if stage_start is None or stage_end is None or not isinstance(stage_type, str):
                continue
            row = {
                "id": _stable_id("sleep-stage", session_id, stage_start, stage_end, stage_type),
                "session_id": session_id,
                "stage_type": stage_type,
                "start_utc": stage_start,
                "end_utc": stage_end,
                "start_offset_seconds": int(_duration_seconds(stage.get("startUtcOffset")) or 0),
                "end_offset_seconds": int(_duration_seconds(stage.get("endUtcOffset")) or 0),
                "provider_create_time": stage.get("createTime"),
                "provider_update_time": stage.get("updateTime"),
                "import_run_id": self.run.id,
                "ingested_at": self.ingested_at,
            }
            row["payload_hash"] = _payload_hash(row)
            stages.append(row)
        events: list[dict[str, Any]] = []
        for field, event_type in (
            ("shortAwakenings", "SHORT_AWAKENING"),
            ("outOfBedSegments", "OUT_OF_BED"),
        ):
            items = value.get(field)
            for event in items if isinstance(items, list) else []:
                if not isinstance(event, dict):
                    continue
                event_start = _normalize_instant(event.get("startTime"))
                event_end = _normalize_instant(event.get("endTime"))
                if event_start is None or event_end is None:
                    continue
                row = {
                    "id": _stable_id("sleep-event", session_id, event_type, event_start, event_end),
                    "session_id": session_id,
                    "event_type": event_type,
                    "start_utc": event_start,
                    "end_utc": event_end,
                    "start_offset_seconds": int(_duration_seconds(event.get("startUtcOffset")) or 0),
                    "end_offset_seconds": int(_duration_seconds(event.get("endUtcOffset")) or 0),
                    "metadata_json": _canonical_json({key: value for key, value in event.items() if key not in {"startTime", "endTime", "startUtcOffset", "endUtcOffset"}}),
                    "import_run_id": self.run.id,
                    "ingested_at": self.ingested_at,
                }
                row["payload_hash"] = _payload_hash(row)
                events.append(row)
        return session, stages, events

    def ingest_sleep(self) -> None:
        for provenance, family in (
            (PROVENANCE_RAW, None),
            (PROVENANCE_WEARABLES, GOOGLE_WEARABLES),
        ):
            for key, _, points in self.pages_for(
                kind="sleep",
                filter_field="sleep.interval.civil_end_time",
                source_family=family,
            ):
                sessions: list[dict[str, Any]] = []
                stages: list[dict[str, Any]] = []
                events: list[dict[str, Any]] = []
                child_ids: dict[str, tuple[set[str], set[str]]] = {}
                for point in points:
                    parsed = self._sleep_rows(point, provenance, family)
                    if parsed is None:
                        continue
                    session, session_stages, session_events = parsed
                    sessions.append(session)
                    stages.extend(session_stages)
                    events.extend(session_events)
                    child_ids[session["id"]] = (
                        {row["id"] for row in session_stages},
                        {row["id"] for row in session_events},
                    )
                changes = [
                    _bulk_upsert(self.db, HealthSleepSessionDB, sessions),
                    _bulk_upsert(self.db, HealthSleepStageDB, stages),
                    _bulk_upsert(self.db, HealthSleepEventDB, events),
                ]
                for session_id, (stage_ids, event_ids) in child_ids.items():
                    existing_stages = self.db.exec(
                        select(HealthSleepStageDB).where(HealthSleepStageDB.session_id == session_id)
                    ).all()
                    for row in existing_stages:
                        if row.id not in stage_ids:
                            self.db.delete(row)
                    existing_events = self.db.exec(
                        select(HealthSleepEventDB).where(HealthSleepEventDB.session_id == session_id)
                    ).all()
                    for row in existing_events:
                        if row.id not in event_ids:
                            self.db.delete(row)
                self._record_changes(key, len(points), changes)
            table = HealthSleepSessionDB.__table__
            self._tombstone_missing(
                HealthSleepSessionDB,
                table.c.provenance == provenance,
                table.c.local_end_date >= self.start,
                table.c.local_end_date < self.end,
            )

    def ingest_exercise(self) -> None:
        query_start = (date.fromisoformat(self.start) - timedelta(days=1)).isoformat()
        for provenance, family in (
            (PROVENANCE_RAW, None),
            (PROVENANCE_WEARABLES, GOOGLE_WEARABLES),
        ):
            for key, _, points in self.pages_for(
                kind="exercise",
                filter_field="exercise.interval.civil_start_time",
                source_family=family,
                query_start=query_start,
            ):
                rows: list[dict[str, Any]] = []
                for point in points:
                    value = point.get("exercise")
                    if not isinstance(value, dict) or not isinstance(value.get("interval"), dict):
                        continue
                    interval = value["interval"]
                    start_utc = _normalize_instant(interval.get("startTime"))
                    end_utc = _normalize_instant(interval.get("endTime"))
                    if start_utc is None or end_utc is None:
                        continue
                    start_offset = _duration_seconds(interval.get("startUtcOffset"))
                    end_offset = _duration_seconds(interval.get("endUtcOffset"))
                    source_id, source = _source_values(point, family or "raw", start_utc)
                    _upsert_source(self.db, source)
                    point_id = _provider_point_id(point)
                    row = {
                        "id": _stable_id("exercise", provenance, source_id, _point_identity(point)),
                        "provider": "google-health",
                        "provider_point_id": point_id,
                        "provenance": provenance,
                        "source_id": source_id,
                        "start_utc": start_utc,
                        "end_utc": end_utc,
                        "start_offset_seconds": int(start_offset) if start_offset is not None else None,
                        "end_offset_seconds": int(end_offset) if end_offset is not None else None,
                        "local_start_date": _local_date(interval.get("civilStartTime"), start_utc, int(start_offset) if start_offset is not None else None),
                        "local_end_date": _local_date(interval.get("civilEndTime"), end_utc, int(end_offset) if end_offset is not None else None),
                        "exercise_type": value.get("exerciseType"),
                        "display_name": value.get("displayName"),
                        "active_duration_seconds": _duration_seconds(value.get("activeDuration")),
                        "provider_create_time": value.get("createTime"),
                        "provider_update_time": value.get("updateTime"),
                        "is_deleted": False,
                        "metadata_json": _canonical_json({
                            "exerciseMetadata": value.get("exerciseMetadata"),
                            "metricsSummary": value.get("metricsSummary"),
                            "exerciseEvents": value.get("exerciseEvents"),
                            "splits": value.get("splits"),
                            "splitSummaries": value.get("splitSummaries"),
                            "notes": value.get("notes"),
                        }),
                        "import_run_id": self.run.id,
                        "ingested_at": self.ingested_at,
                    }
                    row["payload_hash"] = _payload_hash(row)
                    rows.append(row)
                changes = _bulk_upsert(self.db, HealthExerciseSessionDB, rows)
                self._record_changes(key, len(points), [changes])
            table = HealthExerciseSessionDB.__table__
            self._tombstone_missing(
                HealthExerciseSessionDB,
                table.c.provenance == provenance,
                table.c.local_start_date >= self.start,
                table.c.local_start_date < self.end,
            )

    def ingest_daily(self) -> None:
        configs: tuple[tuple[str, str, str], ...] = (
            ("daily-resting-heart-rate", "dailyRestingHeartRate", "daily_resting_heart_rate.date"),
            ("daily-heart-rate-variability", "dailyHeartRateVariability", "daily_heart_rate_variability.date"),
            ("daily-oxygen-saturation", "dailyOxygenSaturation", "daily_oxygen_saturation.date"),
            ("daily-respiratory-rate", "dailyRespiratoryRate", "daily_respiratory_rate.date"),
            ("daily-sleep-temperature-derivations", "dailySleepTemperatureDerivations", "daily_sleep_temperature_derivations.date"),
            ("daily-heart-rate-zones", "dailyHeartRateZones", "daily_heart_rate_zones.date"),
        )
        for kind, union, filter_field in configs:
            for key, _, points in self.pages_for(
                kind=kind,
                filter_field=filter_field,
                source_family=GOOGLE_WEARABLES,
            ):
                rows: list[dict[str, Any]] = []
                for point in points:
                    value = point.get(union)
                    if not isinstance(value, dict):
                        continue
                    day = _civil_date(value.get("date"))
                    if day is None:
                        continue
                    source_id, source = _source_values(point, GOOGLE_WEARABLES, f"{day}T00:00:00Z")
                    _upsert_source(self.db, source)
                    measurements: list[tuple[str, float | None, float | None, str | None, str | None, dict[str, Any]]] = []
                    if kind == "daily-resting-heart-rate":
                        measurements.append(("resting_heart_rate", _finite_number(value.get("beatsPerMinute")), None, "bpm", None, value.get("dailyRestingHeartRateMetadata") or {}))
                    elif kind == "daily-heart-rate-variability":
                        for field, metric, unit in (
                            ("averageHeartRateVariabilityMilliseconds", "daily_hrv_rmssd", "ms"),
                            ("deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds", "daily_deep_sleep_hrv_rmssd", "ms"),
                            ("nonRemHeartRateBeatsPerMinute", "daily_non_rem_heart_rate", "bpm"),
                            ("entropy", "daily_hrv_entropy", "entropy"),
                        ):
                            measurements.append((metric, _finite_number(value.get(field)), None, unit, None, {}))
                    elif kind == "daily-oxygen-saturation":
                        for field, metric in (
                            ("averagePercentage", "daily_oxygen_saturation_average"),
                            ("lowerBoundPercentage", "daily_oxygen_saturation_lower"),
                            ("upperBoundPercentage", "daily_oxygen_saturation_upper"),
                            ("standardDeviationPercentage", "daily_oxygen_saturation_stddev"),
                        ):
                            measurements.append((metric, _finite_number(value.get(field)), None, "percent", None, {}))
                    elif kind == "daily-respiratory-rate":
                        measurements.append(("daily_respiratory_rate", _finite_number(value.get("breathsPerMinute")), None, "breaths/min", None, {}))
                    elif kind == "daily-sleep-temperature-derivations":
                        for field, metric in (
                            ("nightlyTemperatureCelsius", "nightly_sleep_temperature"),
                            ("baselineTemperatureCelsius", "sleep_temperature_baseline"),
                            ("relativeNightlyStddev30dCelsius", "sleep_temperature_relative_stddev_30d"),
                        ):
                            measurements.append((metric, _finite_number(value.get(field)), None, "celsius", None, {}))
                    else:
                        zones = value.get("heartRateZones")
                        for zone in zones if isinstance(zones, list) else []:
                            if isinstance(zone, dict):
                                measurements.append((
                                    "daily_heart_rate_zone",
                                    _finite_number(zone.get("minBeatsPerMinute")),
                                    _finite_number(zone.get("maxBeatsPerMinute")),
                                    "bpm",
                                    zone.get("heartRateZoneType"),
                                    {},
                                ))
                    point_id = _provider_point_id(point)
                    for metric, number, secondary, unit, category, metadata in measurements:
                        if number is None:
                            continue
                        row = {
                            "id": _stable_id("daily", metric, day, PROVENANCE_WEARABLES, source_id, category or ""),
                            "provider": "google-health",
                            "date": day,
                            "metric": metric,
                            "provenance": PROVENANCE_WEARABLES,
                            "category": category,
                            "numeric_value": number,
                            "secondary_value": secondary,
                            "unit": unit,
                            "source_id": source_id,
                            "provider_point_id": point_id,
                            "provider_create_time": value.get("createTime"),
                            "provider_update_time": value.get("updateTime"),
                            "completeness": "complete" if day < _local_today().isoformat() else "partial",
                            "is_deleted": False,
                            "metadata_json": _canonical_json(metadata),
                            "import_run_id": self.run.id,
                            "ingested_at": self.ingested_at,
                        }
                        row["payload_hash"] = _payload_hash(row)
                        rows.append(row)
                changes = _bulk_upsert(self.db, HealthDailyMetricDB, rows)
                self._record_changes(key, len(points), [changes])
            daily_metrics = {
                "daily-resting-heart-rate": ("resting_heart_rate",),
                "daily-heart-rate-variability": (
                    "daily_hrv_rmssd",
                    "daily_deep_sleep_hrv_rmssd",
                    "daily_non_rem_heart_rate",
                    "daily_hrv_entropy",
                ),
                "daily-oxygen-saturation": (
                    "daily_oxygen_saturation_average",
                    "daily_oxygen_saturation_lower",
                    "daily_oxygen_saturation_upper",
                    "daily_oxygen_saturation_stddev",
                ),
                "daily-respiratory-rate": ("daily_respiratory_rate",),
                "daily-sleep-temperature-derivations": (
                    "nightly_sleep_temperature",
                    "sleep_temperature_baseline",
                    "sleep_temperature_relative_stddev_30d",
                ),
                "daily-heart-rate-zones": ("daily_heart_rate_zone",),
            }[kind]
            table = HealthDailyMetricDB.__table__
            self._tombstone_missing(
                HealthDailyMetricDB,
                table.c.provenance == PROVENANCE_WEARABLES,
                table.c.metric.in_(daily_metrics),
                table.c.date >= self.start,
                table.c.date < self.end,
            )

    def build_step_daily_metrics(self) -> None:
        daily_table = HealthDailyMetricDB.__table__
        self.db.exec(
            update(daily_table)
            .where(
                daily_table.c.metric == "steps",
                daily_table.c.date >= self.start,
                daily_table.c.date < self.end,
                daily_table.c.is_deleted == False,  # noqa: E712
            )
            .values(is_deleted=True)
        )
        rows: list[dict[str, Any]] = []
        query = self.db.exec(
            select(
                HealthIntervalObservationDB.local_date,
                HealthIntervalObservationDB.provenance,
                HealthIntervalObservationDB.source_id,
                func.sum(HealthIntervalObservationDB.numeric_value),
            ).where(
                HealthIntervalObservationDB.data_type == "steps",
                HealthIntervalObservationDB.local_date >= self.start,
                HealthIntervalObservationDB.local_date < self.end,
                HealthIntervalObservationDB.is_deleted == False,  # noqa: E712
            ).group_by(
                HealthIntervalObservationDB.local_date,
                HealthIntervalObservationDB.provenance,
                HealthIntervalObservationDB.source_id,
            )
        ).all()
        for day, provenance, source_id, total in query:
            if day is None or total is None:
                continue
            row = {
                "id": _stable_id("daily", "steps", day, provenance, source_id or ""),
                "provider": "google-health",
                "date": day,
                "metric": "steps",
                "provenance": provenance,
                "category": None,
                "numeric_value": float(total),
                "secondary_value": None,
                "unit": "count",
                "source_id": source_id,
                "provider_point_id": None,
                "provider_create_time": None,
                "provider_update_time": None,
                "completeness": "complete" if day < _local_today().isoformat() else "partial",
                "is_deleted": False,
                "metadata_json": "{}",
                "import_run_id": self.run.id,
                "ingested_at": self.ingested_at,
            }
            row["payload_hash"] = _payload_hash(row)
            rows.append(row)
        canonical = self.db.exec(
            text(
                "SELECT date, steps FROM apple_health_daily "
                "WHERE date >= :start AND date < :end AND steps IS NOT NULL"
            ),
            params={"start": self.start, "end": self.end},
        ).all()
        canonical_source_id, canonical_source = _source_values(
            {}, PROVENANCE_CANONICAL, f"{self.start}T00:00:00Z"
        )
        _upsert_source(self.db, canonical_source)
        for day, total in canonical:
            row = {
                "id": _stable_id("daily", "steps", day, PROVENANCE_CANONICAL),
                "provider": "gainlog",
                "date": day,
                "metric": "steps",
                "provenance": PROVENANCE_CANONICAL,
                "category": None,
                "numeric_value": float(total),
                "secondary_value": None,
                "unit": "count",
                "source_id": canonical_source_id,
                "provider_point_id": None,
                "provider_create_time": None,
                "provider_update_time": None,
                "completeness": "complete" if day < _local_today().isoformat() else "partial",
                "is_deleted": False,
                "metadata_json": "{}",
                "import_run_id": self.run.id,
                "ingested_at": self.ingested_at,
            }
            row["payload_hash"] = _payload_hash(row)
            rows.append(row)
        changes = _bulk_upsert(self.db, HealthDailyMetricDB, rows)
        self._record_changes("steps:daily-provenance", len(rows), [changes])
        self.db.commit()

    def build_minute_summaries(self) -> None:
        start = date.fromisoformat(self.start)
        end = date.fromisoformat(self.end)
        for offset in range((end - start).days):
            day = (start + timedelta(days=offset)).isoformat()
            aggregates = self.db.exec(
                select(
                    func.substr(HealthSampleObservationDB.observed_at_utc, 1, 16),
                    HealthSampleObservationDB.local_date,
                    HealthSampleObservationDB.source_id,
                    HealthSampleObservationDB.provenance,
                    func.count(HealthSampleObservationDB.id),
                    func.min(HealthSampleObservationDB.numeric_value),
                    func.max(HealthSampleObservationDB.numeric_value),
                    func.avg(HealthSampleObservationDB.numeric_value),
                ).where(
                    HealthSampleObservationDB.data_type == "heart_rate",
                    HealthSampleObservationDB.local_date == day,
                    HealthSampleObservationDB.is_deleted == False,  # noqa: E712
                ).group_by(
                    func.substr(HealthSampleObservationDB.observed_at_utc, 1, 16),
                    HealthSampleObservationDB.local_date,
                    HealthSampleObservationDB.source_id,
                    HealthSampleObservationDB.provenance,
                )
            ).all()
            rows: list[dict[str, Any]] = []
            for minute, local_day, source_id, provenance, count, minimum, maximum, average in aggregates:
                minute_utc = f"{minute}:00Z"
                row = {
                    "id": _stable_id("minute", "heart_rate", minute_utc, source_id or "", provenance),
                    "metric": "heart_rate",
                    "minute_utc": minute_utc,
                    "local_date": local_day,
                    "source_id": source_id,
                    "provenance": provenance,
                    "unit": "bpm",
                    "sample_count": int(count),
                    "minimum": float(minimum),
                    "maximum": float(maximum),
                    "average": float(average),
                    "import_run_id": self.run.id,
                    "updated_at": self.ingested_at,
                }
                row["payload_hash"] = _payload_hash(row)
                rows.append(row)
                if len(rows) >= PAGE_SIZE:
                    changes = _bulk_upsert(self.db, HealthMinuteSummaryDB, rows)
                    self._record_changes("heart-rate:minute-summary", len(rows), [changes])
                    self.db.commit()
                    rows = []
            if rows:
                changes = _bulk_upsert(self.db, HealthMinuteSummaryDB, rows)
                self._record_changes("heart-rate:minute-summary", len(rows), [changes])
            minute_table = HealthMinuteSummaryDB.__table__
            self.db.exec(
                delete(minute_table).where(
                    minute_table.c.metric == "heart_rate",
                    minute_table.c.local_date == day,
                    minute_table.c.import_run_id != self.run.id,
                )
            )
            self.db.commit()

    def build_quality(self) -> None:
        rows: list[dict[str, Any]] = []
        current = _local_today().isoformat()
        start = date.fromisoformat(self.start)
        end = date.fromisoformat(self.end)
        for offset in range((end - start).days):
            day = (start + timedelta(days=offset)).isoformat()
            partial = day >= current
            hr_count = int(self.db.exec(
                select(func.count(HealthSampleObservationDB.id)).where(
                    HealthSampleObservationDB.data_type == "heart_rate",
                    HealthSampleObservationDB.local_date == day,
                    HealthSampleObservationDB.is_deleted == False,  # noqa: E712
                )
            ).one())
            hr_minutes = int(self.db.exec(
                select(func.count(HealthMinuteSummaryDB.id)).where(
                    HealthMinuteSummaryDB.metric == "heart_rate",
                    HealthMinuteSummaryDB.local_date == day,
                )
            ).one())
            sleep_count = int(self.db.exec(
                select(func.count(HealthSleepSessionDB.id)).where(
                    HealthSleepSessionDB.local_end_date == day,
                    HealthSleepSessionDB.provenance == PROVENANCE_WEARABLES,
                    HealthSleepSessionDB.is_deleted == False,  # noqa: E712
                )
            ).one())
            hrv_count = int(self.db.exec(
                select(func.count(HealthSampleObservationDB.id)).where(
                    HealthSampleObservationDB.data_type == "heart_rate_variability_rmssd",
                    HealthSampleObservationDB.local_date == day,
                    HealthSampleObservationDB.is_deleted == False,  # noqa: E712
                )
            ).one())
            rhr_count = int(self.db.exec(
                select(func.count(HealthDailyMetricDB.id)).where(
                    HealthDailyMetricDB.metric == "resting_heart_rate",
                    HealthDailyMetricDB.date == day,
                    HealthDailyMetricDB.is_deleted == False,  # noqa: E712
                )
            ).one())
            step_sources = int(self.db.exec(
                select(func.count(func.distinct(HealthIntervalObservationDB.source_id))).where(
                    HealthIntervalObservationDB.data_type == "steps",
                    HealthIntervalObservationDB.provenance == PROVENANCE_RAW,
                    HealthIntervalObservationDB.local_date == day,
                    HealthIntervalObservationDB.is_deleted == False,  # noqa: E712
                )
            ).one())
            metrics = (
                ("heart_rate", hr_count, 1440, min(hr_minutes / 1440.0, 1.0), "present" if hr_count else "missing", step_sources > 1),
                ("sleep", sleep_count, 1, min(sleep_count, 1), "present" if sleep_count else "missing", False),
                ("hrv", hrv_count, None, None, "present" if hrv_count else "missing", False),
                ("resting_heart_rate", rhr_count, 1, min(rhr_count, 1), "present" if rhr_count else "missing", False),
                ("steps_sources", step_sources, None, None, "conflict" if step_sources > 1 else "present" if step_sources else "missing", step_sources > 1),
            )
            for metric, observed, expected, coverage, status, conflict in metrics:
                row = {
                    "id": _stable_id("quality", day, metric),
                    "date": day,
                    "metric": metric,
                    "status": "partial" if partial else status,
                    "observed_count": observed,
                    "expected_count": expected,
                    "coverage_ratio": coverage,
                    "source_count": step_sources if metric == "steps_sources" else None,
                    "is_partial_day": partial,
                    "has_source_conflict": conflict,
                    "details_json": _canonical_json({"definition": "shadow-v1"}),
                    "import_run_id": self.run.id,
                    "updated_at": self.ingested_at,
                }
                row["payload_hash"] = _payload_hash(row)
                rows.append(row)
        changes = _bulk_upsert(self.db, HealthDataQualityDB, rows)
        self._record_changes("quality", len(rows), [changes])
        self.db.commit()

    def run_all(self) -> None:
        self.ingest_samples()
        self.ingest_intervals()
        self.ingest_sleep()
        self.ingest_exercise()
        self.ingest_daily()
        self.build_step_daily_metrics()
        self.build_minute_summaries()
        self.build_quality()


def sync_google_health_v2(
    db: Session,
    *,
    start_date: str,
    end_date: str,
    http: Any = None,
) -> dict[str, Any]:
    """Import a bounded range into additive V2 shadow tables.

    Page commits intentionally permit partial failed runs; stable identities make
    retries safe and the import-run row records that the attempt was incomplete.
    """
    start, end = _validate_range(start_date, end_date)
    if http is None:
        import requests
        http = requests
    try:
        from .main import GoogleHealthConnectionDB
    except ImportError:
        from main import GoogleHealthConnectionDB  # type: ignore[no-redef]

    run = HealthImportRunDB(
        id=str(uuid.uuid4()),
        requested_start=start,
        requested_end=end,
        started_at=_now(),
        status="running",
        complete=False,
        source_families_json=_canonical_json(["raw", GOOGLE_WEARABLES, GOOGLE_ALL_SOURCES]),
        db_bytes_before=_db_bytes(db),
        peak_memory_kb=_rss_kb(),
    )
    db.add(run)
    db.commit()
    started = time.monotonic()
    try:
        connection = db.get(GoogleHealthConnectionDB, "primary")
        if not connection or connection.status != "connected" or not connection.encrypted_refresh_token:
            raise GoogleHealthDataError("Google Health is not connected")
        client_id, client_secret, cipher = require_google_health_config()
        response = http.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": cipher.decrypt(connection.encrypted_refresh_token),
            },
            timeout=15,
        )
        run.api_calls += 1
        token_payload = _response_json(response, authorization=True)
        access_token = token_payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleHealthAuthorizationError("Google Health authorization needs reconnection")
        importer = GoogleHealthV2Importer(db, http, access_token, run, start, end)
        importer.run_all()
        run.status = "complete"
        run.complete = True
        run.finished_at = _now()
        run.current_data_type = None
        run.current_page = 0
        run.last_page_token_hash = None
        run.duration_seconds = round(time.monotonic() - started, 3)
        run.peak_memory_kb = _rss_kb()
        run.db_bytes_after = _db_bytes(db)
        run.counts_json = _canonical_json(importer.counts)
        run.pages_json = _canonical_json(importer.pages)
        run.error_summary = None
        db.add(run)
        db.commit()
        return {
            "run_id": run.id,
            "status": run.status,
            "start_date": start,
            "end_date": end,
            "api_calls": run.api_calls,
            "pages_processed": run.pages_processed,
            "records_seen": run.records_seen,
            "records_inserted": run.records_inserted,
            "records_updated": run.records_updated,
            "records_unchanged": run.records_unchanged,
            "peak_memory_kb": run.peak_memory_kb,
            "duration_seconds": run.duration_seconds,
            "db_bytes_before": run.db_bytes_before,
            "db_bytes_after": run.db_bytes_after,
        }
    except Exception as exc:
        db.rollback()
        failed = db.get(HealthImportRunDB, run.id)
        if failed is not None:
            failed.status = "failed"
            failed.complete = False
            failed.finished_at = _now()
            failed.duration_seconds = round(time.monotonic() - started, 3)
            failed.peak_memory_kb = _rss_kb()
            failed.db_bytes_after = _db_bytes(db)
            failed.error_summary = (
                "Google Health authorization needs reconnection"
                if isinstance(exc, GoogleHealthAuthorizationError)
                else "Google Health V2 shadow import failed"
            )
            db.add(failed)
            db.commit()
        raise GoogleHealthV2Error("Google Health V2 shadow import failed") from exc
