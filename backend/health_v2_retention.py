"""Fail-closed retention for GainLog's PostgreSQL V2 shadow-health store."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
import json
import sys
from time import monotonic
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, exists, func
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .database import database_bytes
    from .health_v2_lock import health_v2_writer_locked
    from .health_v2_models import (
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSampleObservationDB,
    )
except ImportError:
    from database import database_bytes
    from health_v2_lock import health_v2_writer_locked
    from health_v2_models import (
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSampleObservationDB,
    )

_SAMPLE_90_DAY_TYPES = ("oxygen_saturation", "respiratory_rate_sleep")
_SAMPLE_365_DAY_TYPES = (
    "heart_rate_variability_rmssd",
    "heart_rate_variability_sdnn",
)
_INTERVAL_90_DAY_TYPES = (
    "time_in_heart_rate_zone",
    "activity_level",
    "active_minutes",
    "active_zone_minutes",
    "sedentary_period",
)
_INTERVAL_365_DAY_TYPES = ("steps",)


def _heart_rate_has_minute_summary():
    sample = HealthSampleObservationDB.__table__
    minute = HealthMinuteSummaryDB.__table__
    return exists(
        select(minute.c.id).where(
            minute.c.metric == "heart_rate",
            minute.c.local_date == sample.c.local_date,
            minute.c.provenance == sample.c.provenance,
            minute.c.source_id.is_not_distinct_from(sample.c.source_id),
            func.substr(minute.c.minute_utc, 1, 16)
            == func.substr(sample.c.observed_at_utc, 1, 16),
        )
    )


def _sample_conditions(cutoff_90: str, cutoff_365: str):
    table = HealthSampleObservationDB.__table__
    return {
        "heart_rate": (
            table.c.data_type == "heart_rate",
            table.c.local_date < cutoff_90,
            _heart_rate_has_minute_summary(),
        ),
        "oxygen_saturation": (
            table.c.data_type == "oxygen_saturation",
            table.c.local_date < cutoff_90,
        ),
        "respiratory_rate_sleep": (
            table.c.data_type == "respiratory_rate_sleep",
            table.c.local_date < cutoff_90,
        ),
        **{
            data_type: (
                table.c.data_type == data_type,
                table.c.local_date < cutoff_365,
            )
            for data_type in _SAMPLE_365_DAY_TYPES
        },
    }


def _interval_conditions(cutoff_90: str, cutoff_365: str):
    table = HealthIntervalObservationDB.__table__
    conditions = {
        data_type: (
            table.c.data_type == data_type,
            table.c.local_date < cutoff_90,
        )
        for data_type in _INTERVAL_90_DAY_TYPES
    }
    conditions.update({
        data_type: (
            table.c.data_type == data_type,
            table.c.local_date < cutoff_365,
        )
        for data_type in _INTERVAL_365_DAY_TYPES
    })
    return conditions


def _unknown_type_counts(db: Session, model, known_types: tuple[str, ...]) -> dict[str, int]:
    rows = db.exec(
        select(model.data_type, func.count(model.id))
        .where(model.data_type.not_in(known_types))
        .group_by(model.data_type)
        .order_by(model.data_type)
    ).all()
    return {data_type: int(count) for data_type, count in rows}


def _count(db: Session, model, conditions: tuple[Any, ...]) -> int:
    return int(db.exec(select(func.count(model.id)).where(*conditions)).one())


def _delete_batched(
    db: Session,
    model,
    conditions: tuple[Any, ...],
    *,
    batch_size: int,
) -> int:
    deleted = 0
    table = model.__table__
    while True:
        ids = db.exec(select(model.id).where(*conditions).limit(batch_size)).all()
        if not ids:
            return deleted
        db.exec(delete(table).where(table.c.id.in_(ids)))
        db.commit()
        deleted += len(ids)


@health_v2_writer_locked
def run_retention(
    engine: Engine,
    *,
    as_of: date,
    apply: bool = False,
    batch_size: int = 5_000,
    today: date | None = None,
) -> dict[str, Any]:
    started = monotonic()
    today = today or datetime.now(ZoneInfo("America/New_York")).date()
    if as_of > today:
        raise ValueError("as_of must not be in the future")
    if batch_size < 1 or batch_size > 10_000:
        raise ValueError("batch_size must be between 1 and 10000")
    cutoff_90 = as_of - timedelta(days=90)
    cutoff_365 = as_of - timedelta(days=365)
    candidates: dict[str, dict[str, int]] = {"sample": {}, "interval": {}}
    deleted: dict[str, dict[str, int]] = {"sample": {}, "interval": {}}
    sample_conditions = _sample_conditions(cutoff_90.isoformat(), cutoff_365.isoformat())
    interval_conditions = _interval_conditions(cutoff_90.isoformat(), cutoff_365.isoformat())
    with Session(engine) as db:
        database_bytes_before = database_bytes(db)
        for data_type, conditions in sample_conditions.items():
            count = _count(db, HealthSampleObservationDB, conditions)
            if count:
                candidates["sample"][data_type] = count
        for data_type, conditions in interval_conditions.items():
            count = _count(db, HealthIntervalObservationDB, conditions)
            if count:
                candidates["interval"][data_type] = count
        unknown_types = {
            "sample": _unknown_type_counts(
                db,
                HealthSampleObservationDB,
                ("heart_rate",) + _SAMPLE_90_DAY_TYPES + _SAMPLE_365_DAY_TYPES,
            ),
            "interval": _unknown_type_counts(
                db,
                HealthIntervalObservationDB,
                _INTERVAL_90_DAY_TYPES + _INTERVAL_365_DAY_TYPES,
            ),
        }
        if apply:
            for data_type, conditions in sample_conditions.items():
                count = _delete_batched(
                    db,
                    HealthSampleObservationDB,
                    conditions,
                    batch_size=batch_size,
                )
                if count:
                    deleted["sample"][data_type] = count
            for data_type, conditions in interval_conditions.items():
                count = _delete_batched(
                    db,
                    HealthIntervalObservationDB,
                    conditions,
                    batch_size=batch_size,
                )
                if count:
                    deleted["interval"][data_type] = count
        database_bytes_after = database_bytes(db)
    return {
        "mode": "apply" if apply else "dry-run",
        "as_of": as_of.isoformat(),
        "cutoffs": {
            "90_days": cutoff_90.isoformat(),
            "365_days": cutoff_365.isoformat(),
        },
        "candidates": candidates,
        "deleted": deleted,
        "unknown_types": unknown_types,
        "batch_size": batch_size,
        "database_bytes_before": database_bytes_before,
        "database_bytes_after": database_bytes_after,
        "duration_seconds": round(monotonic() - started, 6),
    }


def main(
    argv: list[str] | None = None,
    *,
    engine_override: Engine | None = None,
    today: date | None = None,
) -> int:
    parser = argparse.ArgumentParser(description="Apply fail-closed V2 health retention")
    parser.add_argument("--as-of", help="Eastern civil date; defaults to today")
    parser.add_argument("--apply", action="store_true", help="delete eligible rows")
    parser.add_argument("--batch-size", type=int, default=5_000)
    parser.add_argument("--json", action="store_true", help="emit compact JSON receipt")
    args = parser.parse_args(argv)
    local_today = today or datetime.now(ZoneInfo("America/New_York")).date()
    try:
        as_of = date.fromisoformat(args.as_of) if args.as_of else local_today
        if engine_override is None:
            try:
                from .main import engine as application_engine
            except ImportError:
                from main import engine as application_engine

            engine_override = application_engine
        report = run_retention(
            engine_override,
            as_of=as_of,
            apply=args.apply,
            batch_size=args.batch_size,
            today=local_today,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
