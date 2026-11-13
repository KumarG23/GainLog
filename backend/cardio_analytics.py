"""Bounded, sample-derived cardio coverage. Missing minutes never become estimated HR."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import isfinite

MAX_GAP_SECONDS = 120
MIN_COVERAGE = 0.8


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timezone required')
    return parsed.astimezone(timezone.utc)


def summarize(samples: list[tuple[datetime, float]], start: datetime, end: datetime,
              band: tuple[int, int]) -> dict:
    """Trapezoidal interpolation only between adjacent observations <= 2 minutes apart.

    Split at band crossings; no extrapolation to window edges or across gaps.
    """
    if end <= start:
        raise ValueError('empty cardio window')
    points = sorted((t, float(hr)) for t, hr in samples if isfinite(hr) and 30 <= hr <= 240)
    # Duplicate timestamps are ambiguous; only one observation per instant.
    points = list(dict(points).items())
    covered = in_band = weighted = 0.0
    lo, hi = band
    for (a, va), (b, vb) in zip(points, points[1:]):
        gap = (b - a).total_seconds()
        if gap <= 0 or gap > MAX_GAP_SECONDS or b <= start or a >= end:
            continue
        left, right = max(a, start), min(b, end)
        x = (left - a).total_seconds() / gap
        y = (right - a).total_seconds() / gap
        v0, v1 = va + (vb - va) * x, va + (vb - va) * y
        length = (right - left).total_seconds()
        covered += length
        weighted += length * (v0 + v1) / 2
        if v0 == v1:
            in_band += length if lo <= v0 <= hi else 0
        else:
            cuts = sorted({0.0, 1.0, *(
                (edge - v0) / (v1 - v0) for edge in (lo, hi)
                if 0 < (edge - v0) / (v1 - v0) < 1
            )})
            for c, d in zip(cuts, cuts[1:]):
                midpoint = v0 + (v1 - v0) * (c + d) / 2
                if lo <= midpoint <= hi:
                    in_band += length * (d - c)
    seconds = (end - start).total_seconds()
    sufficient = covered / seconds >= MIN_COVERAGE
    return {
        'coverage': round(covered / seconds, 3),
        'coveredMinutes': round(covered / 60, 2),
        'averageHr': round(weighted / covered) if sufficient and covered else None,
        'zone2Minutes': round(in_band / 60, 2) if sufficient else None,
    }


def cardio_windows(session):
    """Only explicitly recorded per-segment windows are admissible for sample analysis."""
    cardio = [ex for ex in session.exercises if ex.kind == 'cardio' and ex.cardio_duration_minutes and ex.cardio_duration_minutes > 0]
    windows = []
    for ex in cardio:
        start = getattr(ex, 'cardio_started_at', None)
        end = getattr(ex, 'cardio_ended_at', None)
        if not start or not end:
            return None
        a, b = parse_time(start), parse_time(end)
        if b <= a or abs((b - a).total_seconds() / 60 - ex.cardio_duration_minutes) > 1:
            return None
        windows.append((a, b))
    if not windows or any(left[1] > right[0] for left, right in zip(sorted(windows), sorted(windows)[1:])):
        return None
    return list(zip(cardio, windows))


def analyze(session, samples: list[tuple[datetime, float]], band: tuple[int, int]) -> dict:
    recorded = cardio_windows(session)
    if recorded is None:
        return {'segments': [], 'zone2Minutes': None, 'benchmarkAverageHr': None,
                'benchmarkCoverage': None, 'protocolCompliant': False,
                'windowSource': 'unverified'}
    segments = []
    zone2 = 0.0
    for ex, (start, end) in recorded:
        result = summarize(samples, start, end, band)
        segments.append({'name': ex.name, 'start': start.isoformat(), 'end': end.isoformat(), **result})
        if 'Hard interval' not in ex.name and result['zone2Minutes'] is not None:
            zone2 += result['zone2Minutes']
    benchmark = None
    if len(recorded) == 1 and recorded[0][0].name == 'Treadmill · Benchmark 3 mph 7%':
        ex, (start, end) = recorded[0]
        # A protocol comparison must represent the same ten-minute interval on every run.
        if (ex.cardio_duration_minutes == 20 and abs((end - start).total_seconds() - 1200) <= 1
                and ex.incline_percent is not None and abs(ex.incline_percent - 7) < .01
                and ex.distance_miles is not None and abs(ex.distance_miles - 1) < .01):
            benchmark = summarize(samples, start + timedelta(minutes=10), end, band)
    return {'segments': segments, 'zone2Minutes': round(zone2, 2) if all(
        segment['zone2Minutes'] is not None for segment in segments if 'Hard interval' not in segment['name']) else None,
        'benchmarkAverageHr': benchmark['averageHr'] if benchmark else None,
        'benchmarkCoverage': benchmark['coverage'] if benchmark else None,
        'protocolCompliant': benchmark is not None, 'windowSource': 'recorded'}
