from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from backend.health_hub import project
from sqlmodel import Session

EASTERN = ZoneInfo('America/New_York')


def times():
    start = datetime.now(EASTERN).replace(hour=8, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(seconds=65)).isoformat()


def pair_payload():
    first, second = times()
    return {'readings': [
        {'time': first, 'systolic': 122, 'diastolic': 78, 'pulse': 64, 'arm': 'left', 'position': 'sitting'},
        {'time': second, 'systolic': 118, 'diastolic': 76, 'pulse': 62, 'arm': 'left', 'position': 'sitting'},
    ]}


def test_bp_pair_readback_session_average_and_hc_dedup(client):
    payload = pair_payload()
    saved = client.post('/longevity/bp/pairs', json=payload)
    assert saved.status_code == 201, saved.text
    assert len(saved.json()['readings']) == 2
    repeat_pair = client.post('/longevity/bp/pairs', json=payload)
    assert repeat_pair.status_code == 201
    assert repeat_pair.json()['pairId'] == saved.json()['pairId']
    assert saved.json()['readings'][0]['pulse'] == 64
    first = payload['readings'][0]
    imported = client.post('/longevity/bp/health-connect', json={**first, 'sourceRecordId': 'cuff-1'})
    assert imported.status_code == 200, imported.text
    assert imported.json()['deduplicated'] is True
    second = client.post('/longevity/bp/health-connect', json={**first, 'time': (datetime.fromisoformat(first['time']) + timedelta(minutes=10)).isoformat(), 'sourceRecordId': 'cuff-2'})
    assert second.status_code == 200
    repeat = client.post('/longevity/bp/health-connect', json={**first, 'time': (datetime.fromisoformat(first['time']) + timedelta(minutes=10)).isoformat(), 'sourceRecordId': 'cuff-2'})
    assert repeat.json()['reading']['id'] == second.json()['reading']['id']
    summary = client.get('/longevity/bp').json()
    assert len(summary['readings']) == 3
    assert summary['average7'] == {'systolic': 121.0, 'diastolic': 77.5, 'sessions': 2}
    from backend.main import engine
    with Session(engine) as db:
        rows = project(db)
    assert len(rows['BP']) == 3
    assert rows['Daily'][0][14:16] == [121.0, 77.5]
    # Weekly averages exclude the in-progress Eastern day, matching the scorecard.
    assert rows['Weekly'][0][14:16] == ['', '']


def test_bp_same_time_different_values_are_not_silently_discarded(client):
    payload = pair_payload()
    assert client.post('/longevity/bp/pairs', json=payload).status_code == 201
    imported = client.post('/longevity/bp/health-connect', json={
        **payload['readings'][0], 'systolic': 130, 'sourceRecordId': 'other-cuff',
    })
    assert imported.status_code == 200
    assert imported.json()['deduplicated'] is False
    assert len(client.get('/longevity/bp').json()['readings']) == 3


def test_cpap_absent_is_not_measured_zero(client):
    result = client.get('/longevity/cpap').json()
    assert result['nights'] == []
    assert result['summary30']['percent6h'] is None
    assert result['summary30']['averageAhi'] is None


def test_bp_validation_rejects_partial_bad_times_and_pressure(client):
    payload = pair_payload()
    for readings in ([payload['readings'][0]],
                     [payload['readings'][0], {**payload['readings'][1], 'time': (datetime.fromisoformat(payload['readings'][0]['time']) + timedelta(minutes=9)).isoformat()}],
                     [{**payload['readings'][0], 'systolic': 50}, payload['readings'][1]],
                     [{**payload['readings'][0], 'time': '2026-01-01T08:00:00'}, payload['readings'][1]]):
        assert client.post('/longevity/bp/pairs', json={'readings': readings}).status_code == 422
    assert client.get('/longevity/bp').json()['readings'] == []


def test_cpap_upsert_missing_not_zero_and_export(client):
    from backend.main import engine
    day = datetime.now(EASTERN).date().isoformat()
    first = {'day': day, 'hours': 6.5, 'ahi': 1.2, 'leakLpm': 15.3, 'maskOffCount': 1}
    assert client.put(f'/longevity/cpap/{day}', json=first).status_code == 200
    updated = {**first, 'hours': 3.5, 'ahi': 2.5, 'leakLpm': None, 'maskOffCount': None}
    assert client.put(f'/longevity/cpap/{day}', json=updated).status_code == 200
    assert client.put('/longevity/cpap/2026-01-01', json=updated).status_code == 422
    assert client.put(f'/longevity/cpap/{day}', json={**updated, 'hours': -1}).status_code == 422
    result = client.get('/longevity/cpap').json()
    assert result['nights'] == [updated]
    assert result['summary30'] == {'observedNights': 1, 'calendarNights': 30, 'nights4h': 0, 'nights6h': 0, 'percent4h': 0, 'percent6h': 0, 'averageAhi': 2.5, 'averageHours': 3.5}
    with Session(engine) as db:
        rows = project(db)
    assert rows['Daily'][0][6:8] == [3.5, 2.5]
    assert rows['Weekly'][0][16] == ''  # Today's night is not a completed-day weekly observation.
