"""Aggregate-only longitudinal validation for GainLog V2 shadow models."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, timedelta
import json
from math import sqrt
from typing import Any, Sequence

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

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


def _average_ranks(values: Sequence[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(indexed):
        end = cursor + 1
        while end < len(indexed) and indexed[end][1] == indexed[cursor][1]:
            end += 1
        rank = (cursor + 1 + end) / 2.0
        for original_index, _ in indexed[cursor:end]:
            ranks[original_index] = rank
        cursor = end
    return ranks


def _spearman(pairs: Sequence[tuple[float, float]]) -> dict[str, float | int | None]:
    if len(pairs) < 3:
        return {"n": len(pairs), "spearman": None}
    first = _average_ranks([pair[0] for pair in pairs])
    second = _average_ranks([pair[1] for pair in pairs])
    first_mean = sum(first) / len(first)
    second_mean = sum(second) / len(second)
    numerator = sum(
        (left - first_mean) * (right - second_mean)
        for left, right in zip(first, second)
    )
    first_scale = sum((value - first_mean) ** 2 for value in first)
    second_scale = sum((value - second_mean) ** 2 for value in second)
    denominator = sqrt(first_scale * second_scale)
    coefficient = numerator / denominator if denominator else None
    return {
        "n": len(pairs),
        "spearman": round(coefficient, 3) if coefficient is not None else None,
    }


def _day_map(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["date"]: row for row in result.get("days", [])}


def validate_shadow_results(
    *,
    sleep: dict[str, Any],
    recovery: dict[str, Any],
    load: dict[str, Any],
    stress: dict[str, Any],
    workout_dates: set[str],
) -> dict[str, Any]:
    """Validate model semantics and report interactions without exposing day-level data."""
    sleep_days = _day_map(sleep)
    recovery_days = _day_map(recovery)
    load_days = _day_map(load)
    stress_days = _day_map(stress)
    common_dates = sorted(
        set(sleep_days) & set(recovery_days) & set(load_days) & set(stress_days)
    )
    violations: Counter[str] = Counter()
    for row in sleep_days.values():
        score = row.get("score")
        if row.get("state") == "unavailable" and score is not None:
            violations["sleep_unavailable_with_score"] += 1
        if score is not None and not 0 <= score <= 100:
            violations["sleep_score_out_of_range"] += 1
        confidence = row.get("confidence")
        if confidence is not None and not 0 <= confidence <= 1:
            violations["sleep_confidence_out_of_range"] += 1
    for row in recovery_days.values():
        score = row.get("score")
        if row.get("state") == "unavailable" and score is not None:
            violations["recovery_unavailable_with_score"] += 1
        if score is not None and not 0 <= score <= 100:
            violations["recovery_score_out_of_range"] += 1
        confidence = row.get("confidence")
        if confidence is not None and not 0 <= confidence <= 1:
            violations["recovery_confidence_out_of_range"] += 1
    for row in load_days.values():
        points = row.get("load_points")
        if row.get("state") == "unavailable" and points is not None:
            violations["load_unavailable_with_points"] += 1
        if row.get("state") == "rest" and points != 0:
            violations["load_rest_with_nonzero_points"] += 1
        if points is not None and points < 0:
            violations["load_negative_points"] += 1
        confidence = row.get("confidence")
        if confidence is not None and not 0 <= confidence <= 1:
            violations["load_confidence_out_of_range"] += 1
    for row in stress_days.values():
        summary = row.get("summary", {})
        state_total = sum(summary.get("state_counts", {}).values())
        if state_total != summary.get("expected_minutes"):
            violations["stress_state_count_mismatch"] += 1
        scored_states = sum(
            summary.get("state_counts", {}).get(state, 0)
            for state in ("low", "moderate", "high")
        )
        if scored_states != summary.get("scored_minutes"):
            violations["stress_scored_count_mismatch"] += 1
    sleep_recovery_pairs = [
        (float(sleep_days[day]["score"]), float(recovery_days[day]["score"]))
        for day in common_dates
        if sleep_days[day].get("score") is not None
        and recovery_days[day].get("score") is not None
    ]
    prior_load_recovery_pairs = []
    for day in common_dates:
        prior_day = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
        if (
            prior_day in load_days
            and load_days[prior_day].get("load_points") is not None
            and recovery_days[day].get("score") is not None
        ):
            prior_load_recovery_pairs.append((
                float(load_days[prior_day]["load_points"]),
                float(recovery_days[day]["score"]),
            ))
    stress_high_fraction_by_day: dict[str, float] = {}
    for day, row in stress_days.items():
        counts = row.get("summary", {}).get("state_counts", {})
        scored = sum(counts.get(state, 0) for state in ("low", "moderate", "high"))
        if scored:
            stress_high_fraction_by_day[day] = counts.get("high", 0) / scored
    stress_recovery_pairs = [
        (stress_high_fraction_by_day[day], float(recovery_days[day]["score"]))
        for day in common_dates
        if day in stress_high_fraction_by_day
        and recovery_days[day].get("score") is not None
    ]
    prior_stress_recovery_pairs = []
    for day in common_dates:
        prior_day = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
        if prior_day in stress_high_fraction_by_day and recovery_days[day].get("score") is not None:
            prior_stress_recovery_pairs.append((
                stress_high_fraction_by_day[prior_day],
                float(recovery_days[day]["score"]),
            ))
    load_stress_pairs = [
        (float(load_days[day]["load_points"]), stress_high_fraction_by_day[day])
        for day in common_dates
        if day in stress_high_fraction_by_day
        and load_days[day].get("load_points") is not None
    ]
    wearable_active_dates = {
        day for day, row in load_days.items() if (row.get("load_points") or 0) > 0
    }
    return {
        "version": "0.1-experimental",
        "structural": {
            "passed": not violations,
            "violation_count": sum(violations.values()),
            "violations": dict(violations),
        },
        "coverage": {
            "common_days": len(common_dates),
            "sleep_available_days": sum(
                row.get("score") is not None for row in sleep_days.values()
            ),
            "recovery_available_days": sum(
                row.get("score") is not None for row in recovery_days.values()
            ),
            "load_available_days": sum(
                row.get("load_points") is not None for row in load_days.values()
            ),
            "stress_baseline_ready_days": sum(
                row.get("summary", {}).get("baseline_days", 0) >= 7
                for row in stress_days.values()
            ),
        },
        "workout_alignment": {
            "logged_days": len(workout_dates),
            "wearable_active_days": len(wearable_active_dates),
            "matched_days": len(workout_dates & wearable_active_dates),
            "logged_only_days": len(workout_dates - wearable_active_dates),
            "wearable_only_days": len(wearable_active_dates - workout_dates),
        },
        "correlations": {
            "sleep_vs_recovery": _spearman(sleep_recovery_pairs),
            "prior_load_vs_recovery": _spearman(prior_load_recovery_pairs),
            "stress_high_fraction_vs_recovery": _spearman(stress_recovery_pairs),
            "prior_stress_high_fraction_vs_recovery": _spearman(prior_stress_recovery_pairs),
            "same_day_load_vs_stress_high_fraction": _spearman(load_stress_pairs),
        },
    }


def evaluate_shadow_window(engine: Engine, start: date, end: date) -> dict[str, Any]:
    if start >= end:
        raise ValueError("start must be before end")
    try:
        from .main import WorkoutSessionDB
    except ImportError:
        from main import WorkoutSessionDB
    sleep = evaluate_sleep_window(engine, start, end)
    recovery = evaluate_recovery_window(engine, start, end)
    load = evaluate_load_window(engine, start, end)
    stress = evaluate_stress_window(engine, start, end, include_timeline=False)
    with Session(engine) as db:
        workouts = db.exec(select(WorkoutSessionDB).where(
            WorkoutSessionDB.date >= start.isoformat(),
            WorkoutSessionDB.date < end.isoformat(),
        )).all()
    workout_dates = {row.date[:10] for row in workouts}
    return validate_shadow_results(
        sleep=sleep,
        recovery=recovery,
        load=load,
        stress=stress,
        workout_dates=workout_dates,
    )


def main(argv: list[str] | None = None, *, engine_override: Engine | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate GainLog V2 shadow model interactions")
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
    validation = evaluate_shadow_window(engine_override, start, end)
    receipt = {
        "model": "shadow-validation",
        "version": "0.1-experimental",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "validation": validation,
    }
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":") if args.json else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
