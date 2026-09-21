"""Explainable experimental sleep scoring for GainLog V2 shadow evaluation."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import json
from statistics import median
from typing import Any

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .health_v2_models import HealthDataQualityDB, HealthSleepSessionDB
except ImportError:
    from health_v2_models import HealthDataQualityDB, HealthSleepSessionDB


@dataclass(frozen=True)
class SleepDayInput:
    total_sleep_minutes: int
    minutes_in_sleep_period: int | None = None
    midpoint_minute: int | None = None
    quality_status: str = "present"


def _duration_score(minutes: int) -> int:
    if minutes <= 300:
        return 0
    if minutes < 420:
        return round((minutes - 300) * 70 / 120)
    if minutes < 480:
        return round(70 + (minutes - 420) * 30 / 60)
    if minutes <= 540:
        return 100
    if minutes < 660:
        return round(100 - (minutes - 540) * 30 / 120)
    return 70


def _state(score: int) -> str:
    if score >= 80:
        return "high"
    if score >= 60:
        return "moderate"
    return "low"


def _efficiency_score(value: float) -> int:
    if value <= 0.70:
        return 0
    if value < 0.85:
        return round((value - 0.70) * 85 / 0.15)
    if value < 0.95:
        return round(85 + (value - 0.85) * 15 / 0.10)
    return 100


def _circular_distance(first: int, second: int) -> int:
    difference = abs((first % 1440) - (second % 1440))
    return min(difference, 1440 - difference)


def _consistency_score(deviation: int) -> int:
    if deviation <= 30:
        return 100
    if deviation < 120:
        return round(100 - (deviation - 30) * 60 / 90)
    if deviation < 180:
        return round(40 - (deviation - 120) * 40 / 60)
    return 0


def score_sleep_day(
    target_date: date,
    observation: SleepDayInput | None,
    *,
    baseline_midpoints: list[int],
) -> dict[str, Any]:
    """Score available inputs without turning missing signals into physiological penalties."""
    del target_date
    if observation is None:
        return {
            "score": None,
            "state": "unavailable",
            "confidence": 0.0,
            "components": {},
        }
    duration = _duration_score(observation.total_sleep_minutes)
    components: dict[str, dict[str, float | int]] = {
        "duration": {
            "score": duration,
            "value_minutes": observation.total_sleep_minutes,
            "weight": 0.6,
        }
    }
    weighted_score = duration * 0.6
    available_weight = 0.6
    period = observation.minutes_in_sleep_period
    if period is not None and period >= observation.total_sleep_minutes and period > 0:
        efficiency = observation.total_sleep_minutes / period
        efficiency_score = _efficiency_score(efficiency)
        components["efficiency"] = {
            "score": efficiency_score,
            "value_percent": round(efficiency * 100, 1),
            "weight": 0.25,
        }
        weighted_score += efficiency_score * 0.25
        available_weight += 0.25
    if observation.midpoint_minute is not None and len(baseline_midpoints) >= 7:
        deviation = round(median(
            _circular_distance(observation.midpoint_minute, value)
            for value in baseline_midpoints
        ))
        consistency_score = _consistency_score(deviation)
        components["consistency"] = {
            "score": consistency_score,
            "deviation_minutes": deviation,
            "baseline_days": len(baseline_midpoints),
            "weight": 0.15,
        }
        weighted_score += consistency_score * 0.15
        available_weight += 0.15
    score = round(weighted_score / available_weight)
    confidence = round(available_weight, 2)
    if observation.quality_status == "partial":
        confidence = min(confidence, 0.5)
    return {
        "score": score,
        "state": _state(score),
        "confidence": confidence,
        "quality_status": observation.quality_status,
        "components": components,
    }


def _midpoint_minute(row: HealthSleepSessionDB) -> int | None:
    try:
        start = datetime.fromisoformat(row.start_utc.replace("Z", "+00:00"))
        end = datetime.fromisoformat(row.end_utc.replace("Z", "+00:00"))
    except ValueError:
        return None
    midpoint = start + (end - start) / 2
    offset = row.end_offset_seconds or row.start_offset_seconds or 0
    local_midpoint = midpoint + timedelta(seconds=offset)
    return local_midpoint.hour * 60 + local_midpoint.minute


def evaluate_sleep_window(engine: Engine, start: date, end: date) -> dict[str, Any]:
    """Evaluate an exclusive date window without persisting or feeding production behavior."""
    if start >= end:
        raise ValueError("start must be before end")
    with Session(engine) as db:
        sessions = db.exec(select(HealthSleepSessionDB).where(
            HealthSleepSessionDB.local_end_date >= start.isoformat(),
            HealthSleepSessionDB.local_end_date < end.isoformat(),
            HealthSleepSessionDB.session_kind == "MAIN_SLEEP",
            HealthSleepSessionDB.is_deleted == False,  # noqa: E712
        )).all()
        qualities = db.exec(select(HealthDataQualityDB).where(
            HealthDataQualityDB.date >= start.isoformat(),
            HealthDataQualityDB.date < end.isoformat(),
            HealthDataQualityDB.metric == "sleep",
        )).all()
    quality_by_date = {row.date: row.status for row in qualities}
    preferred: dict[str, HealthSleepSessionDB] = {}
    priority = {"google_wearables_reconciled": 2, "source_raw": 1}
    for row in sessions:
        key = row.local_end_date
        if key is None:
            continue
        current = preferred.get(key)
        if current is None or (priority.get(row.provenance, 0), row.id) > (
            priority.get(current.provenance, 0), current.id
        ):
            preferred[key] = row
    days = []
    baseline_midpoints: list[int] = []
    cursor = start
    while cursor < end:
        key = cursor.isoformat()
        row = preferred.get(key)
        midpoint = _midpoint_minute(row) if row else None
        observation = None
        if row is not None and row.minutes_asleep is not None:
            observation = SleepDayInput(
                total_sleep_minutes=row.minutes_asleep,
                minutes_in_sleep_period=row.minutes_in_sleep_period,
                midpoint_minute=midpoint,
                quality_status=quality_by_date.get(key, "unknown"),
            )
        result = score_sleep_day(cursor, observation, baseline_midpoints=baseline_midpoints[-28:])
        result["date"] = key
        result["source_provenance"] = row.provenance if row else None
        days.append(result)
        if midpoint is not None and quality_by_date.get(key) == "present":
            baseline_midpoints.append(midpoint)
        cursor += timedelta(days=1)
    scores = [row["score"] for row in days if row["score"] is not None]
    return {
        "days": days,
        "summary": {
            "total_days": len(days),
            "available_days": len(scores),
            "unavailable_days": len(days) - len(scores),
            "score_min": min(scores) if scores else None,
            "score_median": round(median(scores), 1) if scores else None,
            "score_max": max(scores) if scores else None,
        },
    }


def main(argv: list[str] | None = None, *, engine_override: Engine | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate GainLog V2 shadow sleep model")
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
    evaluation = evaluate_sleep_window(engine_override, start, end)
    receipt = {
        "model": "sleep",
        "version": "0.1-experimental",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": evaluation["summary"],
    }
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
