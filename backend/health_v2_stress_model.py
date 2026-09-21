"""Explainable experimental physiological-stress model for GainLog V2."""
from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import json
from statistics import median
from typing import Any, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSleepSessionDB,
    )
except ImportError:
    from health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthIntervalObservationDB,
        HealthMinuteSummaryDB,
        HealthSleepSessionDB,
    )


LOCAL_TIMEZONE = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class StressMinuteInput:
    heart_rate_bpm: float | None
    sample_count: int
    context: str = "unknown"
    quality_status: str = "present"


@dataclass(frozen=True)
class StressBaseline:
    sorted_heart_rates: tuple[float, ...]
    median_bpm: float
    days: int


def build_stress_baseline(day_values: Sequence[Sequence[float]]) -> StressBaseline | None:
    complete_days = [
        tuple(float(value) for value in values)
        for values in day_values
        if len(values) >= 30
    ]
    heart_rates = sorted(value for values in complete_days for value in values)
    if len(complete_days) < 7 or len(heart_rates) < 300:
        return None
    return StressBaseline(
        sorted_heart_rates=tuple(heart_rates),
        median_bpm=float(median(heart_rates)),
        days=len(complete_days),
    )


def score_stress_minute(
    minute_utc: datetime,
    observation: object | None,
    *,
    baseline: StressBaseline | None,
) -> dict[str, Any]:
    """Score one minute without turning missing telemetry into low stress."""
    del minute_utc
    if observation is None:
        return {
            "stress_score": None,
            "state": "unobserved",
            "confidence": 0.0,
            "context": "unknown",
            "components": {},
        }
    if not isinstance(observation, StressMinuteInput):
        raise TypeError("observation must be StressMinuteInput or None")
    confidence = min(max(observation.sample_count / 20.0, 0.0), 1.0)
    if observation.quality_status == "partial":
        confidence = min(confidence, 0.5)
    components = {}
    if observation.heart_rate_bpm is not None:
        components["heart_rate"] = {
            "bpm": observation.heart_rate_bpm,
            "sample_count": observation.sample_count,
        }
    if observation.context in ("exercise", "activity", "sleep"):
        context_confidence = confidence if observation.heart_rate_bpm is not None else 1.0
        return {
            "stress_score": None,
            "state": observation.context,
            "confidence": round(context_confidence, 2),
            "context": observation.context,
            "components": components,
        }
    if observation.heart_rate_bpm is None:
        return {
            "stress_score": None,
            "state": "unobserved",
            "confidence": 0.0,
            "context": observation.context,
            "components": {},
        }
    if observation.context != "sedentary":
        return {
            "stress_score": None,
            "state": "context_unavailable",
            "confidence": 0.0,
            "context": observation.context,
            "components": components,
        }
    if baseline is None:
        return {
            "stress_score": None,
            "state": "baseline_unavailable",
            "confidence": 0.0,
            "context": "sedentary",
            "components": components,
        }
    values = baseline.sorted_heart_rates
    left = bisect_left(values, observation.heart_rate_bpm)
    right = bisect_right(values, observation.heart_rate_bpm)
    percentile = round(((left + right) / 2) / len(values) * 100)
    state = "low" if percentile < 50 else "moderate" if percentile < 85 else "high"
    components["personal_baseline"] = {
        "median_bpm": round(baseline.median_bpm, 1),
        "days": baseline.days,
        "minutes": len(values),
        "percentile": percentile,
        "elevation_bpm": round(observation.heart_rate_bpm - baseline.median_bpm, 1),
    }
    return {
        "stress_score": percentile,
        "state": state,
        "confidence": round(confidence, 2),
        "context": "sedentary",
        "components": components,
    }


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _utc_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")


def _local_day_minutes(day: date) -> list[datetime]:
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TIMEZONE).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=LOCAL_TIMEZONE).astimezone(timezone.utc)
    minutes = []
    cursor = start
    while cursor < end:
        minutes.append(cursor)
        cursor += timedelta(minutes=1)
    return minutes


def _choose_daily_source(rows: Sequence[Any], date_attribute: str) -> dict[str, list[Any]]:
    counts = Counter(
        (getattr(row, date_attribute), row.source_id or "")
        for row in rows
        if getattr(row, date_attribute)
    )
    chosen: dict[str, str] = {}
    for (day, source), count in counts.items():
        current = chosen.get(day)
        if current is None or (count, source) > (counts[(day, current)], current):
            chosen[day] = source
    selected: dict[str, list[Any]] = {}
    for row in rows:
        day = getattr(row, date_attribute)
        if day and (row.source_id or "") == chosen.get(day):
            selected.setdefault(day, []).append(row)
    return selected


def _mark_context(
    context: dict[str, str],
    start_utc: str,
    end_utc: str,
    value: str,
) -> None:
    cursor = _parse_utc(start_utc).replace(second=0, microsecond=0)
    end = _parse_utc(end_utc)
    while cursor < end:
        context[_utc_z(cursor)] = value
        cursor += timedelta(minutes=1)


def evaluate_stress_window(engine: Engine, start: date, end: date) -> dict[str, Any]:
    """Build an explicit minute timeline with personal baseline and context semantics."""
    if start >= end:
        raise ValueError("start must be before end")
    baseline_start = start - timedelta(days=14)
    with Session(engine) as db:
        minute_rows = db.exec(select(HealthMinuteSummaryDB).where(
            HealthMinuteSummaryDB.local_date >= baseline_start.isoformat(),
            HealthMinuteSummaryDB.local_date < end.isoformat(),
            HealthMinuteSummaryDB.metric == "heart_rate",
        )).all()
        activity_rows = db.exec(select(HealthIntervalObservationDB).where(
            HealthIntervalObservationDB.local_date >= baseline_start.isoformat(),
            HealthIntervalObservationDB.local_date < end.isoformat(),
            HealthIntervalObservationDB.data_type == "activity_level",
            HealthIntervalObservationDB.provenance == "source_raw",
            HealthIntervalObservationDB.is_deleted == False,  # noqa: E712
        )).all()
        exercise_rows = db.exec(select(HealthExerciseSessionDB).where(
            HealthExerciseSessionDB.local_end_date >= baseline_start.isoformat(),
            HealthExerciseSessionDB.local_end_date < end.isoformat(),
            HealthExerciseSessionDB.provenance == "google_wearables_reconciled",
            HealthExerciseSessionDB.is_deleted == False,  # noqa: E712
        )).all()
        sleep_rows = db.exec(select(HealthSleepSessionDB).where(
            HealthSleepSessionDB.local_end_date >= baseline_start.isoformat(),
            HealthSleepSessionDB.local_end_date < end.isoformat(),
            HealthSleepSessionDB.provenance == "google_wearables_reconciled",
            HealthSleepSessionDB.session_kind == "MAIN_SLEEP",
            HealthSleepSessionDB.is_deleted == False,  # noqa: E712
        )).all()
        quality_rows = db.exec(select(HealthDataQualityDB).where(
            HealthDataQualityDB.date >= baseline_start.isoformat(),
            HealthDataQualityDB.date < end.isoformat(),
            HealthDataQualityDB.metric == "heart_rate",
        )).all()
    minute_by_day = _choose_daily_source(minute_rows, "local_date")
    activity_by_day = _choose_daily_source(activity_rows, "local_date")
    quality_by_day = {row.date: row for row in quality_rows}
    heart_rate_by_day: dict[str, dict[str, HealthMinuteSummaryDB]] = {}
    context_by_minute: dict[str, str] = {}
    for day, rows in minute_by_day.items():
        heart_rate_by_day[day] = {_utc_z(_parse_utc(row.minute_utc)): row for row in rows}
    for rows in activity_by_day.values():
        for row in rows:
            context = "sedentary" if row.category == "SEDENTARY" else "activity"
            _mark_context(context_by_minute, row.start_utc, row.end_utc, context)
    for row in sleep_rows:
        _mark_context(context_by_minute, row.start_utc, row.end_utc, "sleep")
    for row in exercise_rows:
        _mark_context(context_by_minute, row.start_utc, row.end_utc, "exercise")
    sedentary_history: dict[date, list[float]] = {}
    days: list[dict[str, Any]] = []
    cursor = baseline_start
    while cursor < end:
        key = cursor.isoformat()
        quality = quality_by_day.get(key)
        prior_values = [
            values
            for observed_day, values in sorted(sedentary_history.items())
            if cursor - timedelta(days=14) <= observed_day < cursor
        ]
        baseline = build_stress_baseline(prior_values)
        minute_map = heart_rate_by_day.get(key, {})
        timeline = []
        daily_sedentary_values: list[float] = []
        for minute in _local_day_minutes(cursor):
            stamp = _utc_z(minute)
            heart_rate = minute_map.get(stamp)
            context = context_by_minute.get(stamp, "unknown")
            if heart_rate is not None:
                observation = StressMinuteInput(
                    heart_rate_bpm=heart_rate.average,
                    sample_count=heart_rate.sample_count,
                    context=context,
                    quality_status=quality.status if quality else "unknown",
                )
            elif context in ("sedentary", "activity", "exercise", "sleep"):
                observation = StressMinuteInput(
                    heart_rate_bpm=None,
                    sample_count=0,
                    context=context,
                    quality_status=quality.status if quality else "unknown",
                )
            else:
                observation = None
            result = score_stress_minute(minute, observation, baseline=baseline)
            result["minute_utc"] = stamp
            timeline.append(result)
            if (
                heart_rate is not None
                and context == "sedentary"
                and quality is not None
                and quality.status == "present"
            ):
                daily_sedentary_values.append(heart_rate.average)
        if daily_sedentary_values:
            sedentary_history[cursor] = daily_sedentary_values
        if cursor >= start:
            states = Counter(row["state"] for row in timeline)
            scores = [row["stress_score"] for row in timeline if row["stress_score"] is not None]
            days.append({
                "date": key,
                "timeline": timeline,
                "summary": {
                    "expected_minutes": len(timeline),
                    "observed_heart_rate_minutes": len(minute_map),
                    "unobserved_minutes": states["unobserved"],
                    "scored_minutes": len(scores),
                    "stress_median": round(median(scores), 1) if scores else None,
                    "state_counts": dict(states),
                    "source_id": next(iter(minute_map.values())).source_id if minute_map else None,
                    "baseline_days": baseline.days if baseline else 0,
                    "baseline_minutes": len(baseline.sorted_heart_rates) if baseline else 0,
                },
            })
        cursor += timedelta(days=1)
    aggregate_states: Counter[str] = Counter()
    for day_result in days:
        aggregate_states.update(day_result["summary"]["state_counts"])
    return {
        "days": days,
        "summary": {
            "total_days": len(days),
            "expected_minutes": sum(day["summary"]["expected_minutes"] for day in days),
            "observed_heart_rate_minutes": sum(
                day["summary"]["observed_heart_rate_minutes"] for day in days
            ),
            "scored_minutes": sum(day["summary"]["scored_minutes"] for day in days),
            "state_counts": dict(aggregate_states),
        },
    }


def main(argv: list[str] | None = None, *, engine_override: Engine | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate GainLog V2 shadow stress model")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    if engine_override is None:
        try:
            from .main import engine as application_engine
        except ImportError:
            from main import engine as application_engine
        engine_override = application_engine
    evaluation = evaluate_stress_window(engine_override, start, end)
    receipt = {
        "model": "stress",
        "version": "0.1-experimental",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": evaluation["summary"],
    }
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
