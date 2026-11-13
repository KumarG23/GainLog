from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from backend.cardio_analytics import analyze, summarize


def sample(minute, hr, start=None):
    start = start or datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
    return (start + timedelta(minutes=minute), hr)


def test_gap_coverage_and_crossing_are_bounded():
    start = sample(0, 100)[0]
    result = summarize([sample(0, 100), sample(1, 140)], start, start + timedelta(minutes=1), (110, 130))
    assert result['coverage'] == 1
    assert result['zone2Minutes'] == .5
    assert result['averageHr'] == 120
    gap = summarize([sample(0, 120), sample(10, 120)], start, start + timedelta(minutes=10), (110, 130))
    assert gap['coverage'] == 0
    assert gap['zone2Minutes'] is None
    assert gap['averageHr'] is None


def test_interval_segments_and_benchmark_require_complete_protocol():
    start = sample(0, 120)[0]
    session = SimpleNamespace(date=(start + timedelta(minutes=20)).isoformat(), exercises=[
        SimpleNamespace(name='Treadmill · Benchmark 3 mph 7%', kind='cardio', cardio_duration_minutes=20,
                        incline_percent=7, distance_miles=1)])
    points = [sample(i, 130 if i >= 10 else 120) for i in range(21)]
    result = analyze(session, points, (110, 130))
    assert result['benchmarkAverageHr'] == 130
    assert result['zone2Minutes'] == 20
    session.exercises[0].distance_miles = 1.1
    assert analyze(session, points, (110, 130))['benchmarkAverageHr'] is None
    session.exercises = [SimpleNamespace(name='Treadmill · Hard interval 1', kind='cardio', cardio_duration_minutes=4,
                                         incline_percent=None, distance_miles=None)]
    session.date = (start + timedelta(minutes=4)).isoformat()
    assert analyze(session, [sample(i, 160) for i in range(5)], (110, 130))['zone2Minutes'] == 0
