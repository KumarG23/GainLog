"""Explainable experimental training-load model for GainLog V2 shadow evaluation."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
import json
from statistics import median
from typing import Any, Sequence

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthIntervalObservationDB,
    )
except ImportError:
    from health_v2_models import (
        HealthDataQualityDB,
        HealthExerciseSessionDB,
        HealthIntervalObservationDB,
    )


@dataclass(frozen=True)
class LoadDayInput:
    exercise_minutes: float
    zone_minutes: dict[str, float] = field(default_factory=dict)
    heart_rate_coverage: float | None = None
    quality_status: str = "present"


def score_load_day(
    target_date: date,
    observation: object | None,
    *,
    baseline_points: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Estimate observed training load without calling missing data a rest day."""
    del target_date
    if observation is None:
        return {
            "load_points": None,
            "state": "unavailable",
            "confidence": 0.0,
            "components": {},
        }
    if not isinstance(observation, LoadDayInput):
        raise TypeError("observation must be LoadDayInput or None")
    if observation.exercise_minutes < 0:
        raise ValueError("exercise_minutes cannot be negative")
    if observation.exercise_minutes == 0:
        coverage = observation.heart_rate_coverage
        confidence = max(0.0, min(1.0, coverage if coverage is not None else 0.0))
        if observation.quality_status == "partial":
            confidence = min(confidence, 0.5)
        return {
            "load_points": 0,
            "state": "rest",
            "confidence": round(confidence, 2),
            "quality_status": observation.quality_status,
            "components": {
                "exercise_duration": {"minutes": 0, "base_points": 0}
            },
        }
    duration = float(observation.exercise_minutes)
    zones = {
        category: max(0.0, float(observation.zone_minutes.get(category, 0.0)))
        for category in ("LIGHT", "MODERATE", "VIGOROUS", "PEAK")
    }
    zone_total = sum(zones.values())
    if zone_total > duration:
        scale = duration / zone_total
        zones = {category: minutes * scale for category, minutes in zones.items()}
        zone_total = duration
    intensity_bonus = zones["MODERATE"] + zones["VIGOROUS"] * 2 + zones["PEAK"] * 3
    coverage = zone_total / duration
    confidence = 0.5 + coverage * 0.5
    if observation.quality_status == "partial":
        confidence = min(confidence, 0.5)
    clean_zones = {
        category: round(minutes, 2)
        for category, minutes in zones.items()
    }
    load_points = round(duration + intensity_bonus)
    baseline = None
    state = "observed"
    active_baseline = [float(value) for value in (baseline_points or ()) if value > 0]
    if len(active_baseline) >= 7:
        baseline_median = float(median(active_baseline))
        ratio = load_points / baseline_median
        state = "high" if ratio > 1.25 else "typical" if ratio >= 0.75 else "low"
        baseline = {
            "median_active_day_points": round(baseline_median, 1),
            "active_days": len(active_baseline),
            "ratio": round(ratio, 2),
        }
    result = {
        "load_points": load_points,
        "state": state,
        "confidence": round(confidence, 2),
        "quality_status": observation.quality_status,
        "components": {
            "exercise_duration": {
                "minutes": round(duration, 2),
                "base_points": round(duration),
            },
            "heart_rate_zones": {
                "minutes": clean_zones,
                "covered_minutes": round(zone_total, 2),
                "coverage_ratio": round(coverage, 2),
                "intensity_bonus_points": round(intensity_bonus),
            },
        },
    }
    if baseline is not None:
        result["baseline"] = baseline
    return result


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _trailing_active_points(history: Sequence[tuple[date, float]], target: date) -> list[float]:
    cutoff = target - timedelta(days=28)
    return [float(points) for observed, points in history if cutoff <= observed < target]


def _overlap_minutes(
    interval_start: datetime,
    interval_end: datetime,
    exercise_windows: list[tuple[datetime, datetime]],
) -> float:
    overlaps = []
    for exercise_start, exercise_end in exercise_windows:
        start = max(interval_start, exercise_start)
        end = min(interval_end, exercise_end)
        if start < end:
            overlaps.append((start, end))
    if not overlaps:
        return 0.0
    overlaps.sort()
    merged = [overlaps[0]]
    for start, end in overlaps[1:]:
        previous_start, previous_end = merged[-1]
        if start <= previous_end:
            merged[-1] = (previous_start, max(previous_end, end))
        else:
            merged.append((start, end))
    return sum((end - start).total_seconds() for start, end in merged) / 60.0


def evaluate_load_window(engine: Engine, start: date, end: date) -> dict[str, Any]:
    """Evaluate an exclusive date window from reconciled exercise and overlapping HR zones."""
    if start >= end:
        raise ValueError("start must be before end")
    baseline_start = start - timedelta(days=28)
    with Session(engine) as db:
        sessions = db.exec(select(HealthExerciseSessionDB).where(
            HealthExerciseSessionDB.local_end_date >= baseline_start.isoformat(),
            HealthExerciseSessionDB.local_end_date < end.isoformat(),
            HealthExerciseSessionDB.provenance == "google_wearables_reconciled",
            HealthExerciseSessionDB.is_deleted == False,  # noqa: E712
        )).all()
        zones = db.exec(select(HealthIntervalObservationDB).where(
            HealthIntervalObservationDB.local_date >= baseline_start.isoformat(),
            HealthIntervalObservationDB.local_date < end.isoformat(),
            HealthIntervalObservationDB.data_type == "time_in_heart_rate_zone",
            HealthIntervalObservationDB.provenance == "source_raw",
            HealthIntervalObservationDB.is_deleted == False,  # noqa: E712
        )).all()
        qualities = db.exec(select(HealthDataQualityDB).where(
            HealthDataQualityDB.date >= baseline_start.isoformat(),
            HealthDataQualityDB.date < end.isoformat(),
            HealthDataQualityDB.metric == "heart_rate",
        )).all()
    sessions_by_day: dict[str, list[HealthExerciseSessionDB]] = {}
    for row in sessions:
        if row.local_end_date:
            sessions_by_day.setdefault(row.local_end_date, []).append(row)
    zones_by_day: dict[str, list[HealthIntervalObservationDB]] = {}
    for row in zones:
        if row.local_date:
            zones_by_day.setdefault(row.local_date, []).append(row)
    quality_by_day = {row.date: row for row in qualities}
    active_baseline: list[tuple[date, float]] = []
    days: list[dict[str, Any]] = []
    cursor = baseline_start
    while cursor < end:
        key = cursor.isoformat()
        day_sessions = sessions_by_day.get(key, [])
        windows = [(_parse_utc(row.start_utc), _parse_utc(row.end_utc)) for row in day_sessions]
        exercise_minutes = 0.0
        for row, (session_start, session_end) in zip(day_sessions, windows):
            seconds = row.active_duration_seconds
            exercise_minutes += (
                seconds / 60.0
                if seconds is not None
                else (session_end - session_start).total_seconds() / 60.0
            )
        zone_minutes: dict[str, float] = {}
        for row in zones_by_day.get(key, []):
            if row.category not in ("LIGHT", "MODERATE", "VIGOROUS", "PEAK"):
                continue
            minutes = _overlap_minutes(_parse_utc(row.start_utc), _parse_utc(row.end_utc), windows)
            zone_minutes[row.category] = zone_minutes.get(row.category, 0.0) + minutes
        quality = quality_by_day.get(key)
        observation = None
        if day_sessions:
            observation = LoadDayInput(
                exercise_minutes=exercise_minutes,
                zone_minutes=zone_minutes,
                heart_rate_coverage=quality.coverage_ratio if quality else None,
                quality_status=quality.status if quality else "unknown",
            )
        elif quality is not None and quality.status in ("present", "partial"):
            observation = LoadDayInput(
                exercise_minutes=0,
                heart_rate_coverage=quality.coverage_ratio,
                quality_status=quality.status,
            )
        result = score_load_day(
            cursor,
            observation,
            baseline_points=_trailing_active_points(active_baseline, cursor),
        )
        result["date"] = key
        if cursor >= start:
            days.append(result)
        points = result["load_points"]
        if points is not None and points > 0:
            active_baseline.append((cursor, float(points)))
        cursor += timedelta(days=1)
    values = [row["load_points"] for row in days if row["load_points"] is not None]
    return {
        "days": days,
        "summary": {
            "total_days": len(days),
            "available_days": len(values),
            "unavailable_days": len(days) - len(values),
            "active_days": sum(value > 0 for value in values),
            "load_min": min(values) if values else None,
            "load_median": round(median(values), 1) if values else None,
            "load_max": max(values) if values else None,
        },
    }


def main(argv: list[str] | None = None, *, engine_override: Engine | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate GainLog V2 shadow training-load model")
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
    evaluation = evaluate_load_window(engine_override, start, end)
    receipt = {
        "model": "load",
        "version": "0.1-experimental",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": evaluation["summary"],
    }
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
