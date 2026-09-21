"""Read-only Today payload composed from GainLog V2 health models."""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Engine

try:
    from .health_v2_load_model import evaluate_load_window
    from .health_v2_recovery_model import evaluate_recovery_window
    from .health_v2_sleep_model import evaluate_sleep_window
    from .health_v2_stress_model import evaluate_stress_window
except ImportError:
    from health_v2_load_model import evaluate_load_window
    from health_v2_recovery_model import evaluate_recovery_window
    from health_v2_sleep_model import evaluate_sleep_window
    from health_v2_stress_model import evaluate_stress_window


LOCAL_TIMEZONE = ZoneInfo("America/New_York")
_CONTEXT_STATES = (
    "exercise",
    "activity",
    "sleep",
    "baseline_unavailable",
    "context_unavailable",
    "unobserved",
)


def _score_state(score: float) -> str:
    if score >= 85:
        return "high"
    if score >= 50:
        return "moderate"
    return "low"


def aggregate_stress_timeline(
    timeline: Sequence[dict[str, Any]],
    *,
    minutes_per_segment: int = 30,
) -> list[dict[str, Any]]:
    if minutes_per_segment <= 0:
        raise ValueError("minutes_per_segment must be positive")
    segments = []
    for start in range(0, len(timeline), minutes_per_segment):
        rows = timeline[start:start + minutes_per_segment]
        scores = [float(row["stress_score"]) for row in rows if row.get("stress_score") is not None]
        scored_confidences = [
            float(row["confidence"])
            for row in rows
            if row.get("stress_score") is not None and row.get("confidence") is not None
        ]
        if scores:
            score = round(sum(scores) / len(scores), 1)
            state = _score_state(score)
            confidence = round(float(median(scored_confidences)), 2) if scored_confidences else 0.0
        else:
            counts = Counter(str(row.get("state", "unobserved")) for row in rows)
            state = max(_CONTEXT_STATES, key=lambda candidate: (counts[candidate], -_CONTEXT_STATES.index(candidate)))
            context_confidences = [float(row.get("confidence", 0.0)) for row in rows]
            score = None
            confidence = round(float(median(context_confidences)), 2) if context_confidences else 0.0
        segments.append({
            "start_minute": start,
            "state": state,
            "score": score,
            "confidence": confidence,
        })
    return segments


def _camel_key(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(piece[:1].upper() + piece[1:] for piece in tail)


def _camelize(value: Any) -> Any:
    if isinstance(value, dict):
        return {_camel_key(str(key)): _camelize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    return value


def build_health_v2_today(
    engine: Engine,
    target_date: date,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compose one explainable, non-persisted Today response."""
    end = target_date + timedelta(days=1)
    sleep_days = evaluate_sleep_window(engine, target_date - timedelta(days=28), end)["days"]
    sleep = next(row for row in sleep_days if row["date"] == target_date.isoformat())
    recovery = evaluate_recovery_window(engine, target_date, end)["days"][0]
    load = evaluate_load_window(engine, target_date, end)["days"][0]
    stress_day = evaluate_stress_window(
        engine,
        target_date,
        end,
        include_timeline=True,
    )["days"][0]
    timeline = stress_day["timeline"]
    current = (now or datetime.now(LOCAL_TIMEZONE)).astimezone(LOCAL_TIMEZONE)
    if current.date() == target_date:
        elapsed_minutes = current.hour * 60 + current.minute + 1
        elapsed = timeline[:elapsed_minutes]
        segments = aggregate_stress_timeline(elapsed)
        remaining_start = len(segments) * 30
        while remaining_start < len(timeline):
            segments.append({
                "start_minute": remaining_start,
                "state": "future",
                "score": None,
                "confidence": 0.0,
            })
            remaining_start += 30
    else:
        elapsed = timeline
        segments = aggregate_stress_timeline(timeline)
    states = Counter(str(row["state"]) for row in elapsed)
    scores = [float(row["stress_score"]) for row in elapsed if row.get("stress_score") is not None]
    confidences = [
        float(row["confidence"])
        for row in elapsed
        if row.get("stress_score") is not None and row.get("confidence") is not None
    ]
    stress_score = round(float(median(scores)), 1) if scores else None
    observed_minutes = sum(
        row.get("components", {}).get("heart_rate") is not None
        for row in elapsed
    )
    baseline_days = int(stress_day["summary"].get("baseline_days", 0))
    if stress_score is not None:
        stress_state = _score_state(stress_score)
    elif observed_minutes and baseline_days < 7:
        stress_state = "warming_up"
    else:
        stress_state = "unavailable"
    stress = {
        "score": stress_score,
        "state": stress_state,
        "confidence": round(float(median(confidences)), 2) if confidences else 0.0,
        "baseline_ready": baseline_days >= 7,
        "baseline_days": baseline_days,
        "expected_minutes": len(elapsed),
        "observed_heart_rate_minutes": observed_minutes,
        "scored_minutes": len(scores),
        "state_counts": dict(states),
        "segments": segments,
    }
    for row in (sleep, recovery, load):
        row.pop("date", None)
        row.pop("source_provenance", None)
    return _camelize({
        "date": target_date.isoformat(),
        "version": "0.1-experimental",
        "provenance": "google-health-v2",
        "sleep": sleep,
        "recovery": recovery,
        "load": load,
        "stress": stress,
    })
