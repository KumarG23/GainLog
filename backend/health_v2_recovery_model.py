"""Explainable experimental recovery scoring for GainLog V2 shadow evaluation."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, timedelta
import json
from statistics import median
from typing import Any

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

try:
    from .health_v2_models import HealthDailyMetricDB, HealthDataQualityDB
    from .health_v2_sleep_model import evaluate_sleep_window
except ImportError:
    from health_v2_models import HealthDailyMetricDB, HealthDataQualityDB
    from health_v2_sleep_model import evaluate_sleep_window


@dataclass(frozen=True)
class RecoveryDayInput:
    sleep_score: int | None = None
    sleep_confidence: float = 0.0
    hrv_rmssd: float | None = None
    resting_heart_rate: float | None = None
    quality_status: str = "present"


def _state(score: int) -> str:
    if score >= 80:
        return "high"
    if score >= 60:
        return "moderate"
    return "low"


def _clamp_score(value: float) -> int:
    return round(max(0.0, min(100.0, value)))


def _hrv_score(value: float, baseline: float) -> int:
    return _clamp_score(70 + ((value - baseline) / baseline) * 200)


def _rhr_score(value: float, baseline: float) -> int:
    return _clamp_score(70 + ((baseline - value) / baseline) * 400)


def score_recovery_day(
    target_date: date,
    observation: object | None,
    *,
    baseline_hrv: list[float],
    baseline_rhr: list[float],
) -> dict[str, Any]:
    """Score available recovery inputs without penalizing absent signals."""
    del target_date
    if observation is None:
        return {
            "score": None,
            "state": "unavailable",
            "confidence": 0.0,
            "components": {},
        }
    if not isinstance(observation, RecoveryDayInput):
        raise TypeError("observation must be RecoveryDayInput or None")
    components: dict[str, dict[str, float | int]] = {}
    weighted_score = 0.0
    available_weight = 0.0
    confidence_weight = 0.0
    if observation.sleep_score is not None:
        components["sleep"] = {
            "score": observation.sleep_score,
            "source_confidence": observation.sleep_confidence,
            "weight": 0.4,
        }
        weighted_score += observation.sleep_score * 0.4
        available_weight += 0.4
        confidence_weight += 0.4 * observation.sleep_confidence
    if observation.hrv_rmssd is not None and len(baseline_hrv) >= 14:
        baseline = float(median(baseline_hrv))
        if baseline > 0:
            deviation = (observation.hrv_rmssd - baseline) / baseline * 100
            hrv_score = _hrv_score(observation.hrv_rmssd, baseline)
            components["hrv"] = {
                "score": hrv_score,
                "value_ms": observation.hrv_rmssd,
                "baseline_median_ms": baseline,
                "deviation_percent": round(deviation, 1),
                "baseline_days": len(baseline_hrv),
                "weight": 0.35,
            }
            weighted_score += hrv_score * 0.35
            available_weight += 0.35
            confidence_weight += 0.35
    if observation.resting_heart_rate is not None and len(baseline_rhr) >= 14:
        baseline = float(median(baseline_rhr))
        if baseline > 0:
            deviation_bpm = observation.resting_heart_rate - baseline
            deviation_percent = deviation_bpm / baseline * 100
            rhr_score = _rhr_score(observation.resting_heart_rate, baseline)
            components["resting_heart_rate"] = {
                "score": rhr_score,
                "value_bpm": observation.resting_heart_rate,
                "baseline_median_bpm": baseline,
                "deviation_bpm": round(deviation_bpm, 1),
                "deviation_percent": round(deviation_percent, 1),
                "baseline_days": len(baseline_rhr),
                "weight": 0.25,
            }
            weighted_score += rhr_score * 0.25
            available_weight += 0.25
            confidence_weight += 0.25
    if available_weight == 0:
        return {
            "score": None,
            "state": "unavailable",
            "confidence": 0.0,
            "components": {},
        }
    score = round(weighted_score / available_weight)
    confidence = round(confidence_weight, 2)
    if observation.quality_status == "partial":
        confidence = min(confidence, 0.5)
    return {
        "score": score,
        "state": _state(score),
        "confidence": confidence,
        "quality_status": observation.quality_status,
        "components": components,
    }


def evaluate_recovery_window(engine: Engine, start: date, end: date) -> dict[str, Any]:
    """Evaluate an exclusive date window using only trailing, complete baselines."""
    if start >= end:
        raise ValueError("start must be before end")
    baseline_start = start - timedelta(days=28)
    metric_names = ("daily_hrv_rmssd", "resting_heart_rate")
    with Session(engine) as db:
        metrics = db.exec(select(HealthDailyMetricDB).where(
            HealthDailyMetricDB.date >= baseline_start.isoformat(),
            HealthDailyMetricDB.date < end.isoformat(),
            HealthDailyMetricDB.metric.in_(metric_names),
            HealthDailyMetricDB.provenance == "google_wearables_reconciled",
            HealthDailyMetricDB.is_deleted == False,  # noqa: E712
        )).all()
        qualities = db.exec(select(HealthDataQualityDB).where(
            HealthDataQualityDB.date >= baseline_start.isoformat(),
            HealthDataQualityDB.date < end.isoformat(),
            HealthDataQualityDB.metric.in_(("sleep", "hrv", "resting_heart_rate")),
        )).all()
    metric_by_day: dict[str, dict[str, float]] = {}
    for row in metrics:
        if row.numeric_value is not None:
            metric_by_day.setdefault(row.date, {})[row.metric] = row.numeric_value
    quality_by_day: dict[str, dict[str, str]] = {}
    for row in qualities:
        quality_by_day.setdefault(row.date, {})[row.metric] = row.status
    sleep_days = {
        row["date"]: row
        for row in evaluate_sleep_window(engine, baseline_start, end)["days"]
    }
    baseline_hrv: list[float] = []
    baseline_rhr: list[float] = []
    days: list[dict[str, Any]] = []
    cursor = baseline_start
    while cursor < end:
        key = cursor.isoformat()
        metric_values = metric_by_day.get(key, {})
        quality = quality_by_day.get(key, {})
        sleep = sleep_days[key]
        statuses = [
            quality.get(metric)
            for metric in ("sleep", "hrv", "resting_heart_rate")
            if quality.get(metric) is not None
        ]
        quality_status = "partial" if "partial" in statuses else "present" if statuses else "unknown"
        hrv = metric_values.get("daily_hrv_rmssd")
        rhr = metric_values.get("resting_heart_rate")
        observation = None
        if sleep["score"] is not None or hrv is not None or rhr is not None:
            observation = RecoveryDayInput(
                sleep_score=sleep["score"],
                sleep_confidence=sleep["confidence"],
                hrv_rmssd=hrv,
                resting_heart_rate=rhr,
                quality_status=quality_status,
            )
        result = score_recovery_day(
            cursor,
            observation,
            baseline_hrv=baseline_hrv[-28:],
            baseline_rhr=baseline_rhr[-28:],
        )
        result["date"] = key
        if cursor >= start:
            days.append(result)
        if hrv is not None and quality.get("hrv") == "present":
            baseline_hrv.append(hrv)
        if rhr is not None and quality.get("resting_heart_rate") == "present":
            baseline_rhr.append(rhr)
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
    parser = argparse.ArgumentParser(description="Evaluate GainLog V2 shadow recovery model")
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
    evaluation = evaluate_recovery_window(engine_override, start, end)
    receipt = {
        "model": "recovery",
        "version": "0.1-experimental",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": evaluation["summary"],
    }
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
