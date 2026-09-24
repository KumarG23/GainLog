"""Server-owned weekly plan overrides, independent of completed workout history."""
import os
from datetime import date, timedelta
from pathlib import Path

TEST_DB = Path('/tmp/gainlog-test.db')
os.environ['GAINLOG_DATABASE_URL'] = f'sqlite:///{TEST_DB}'

from fastapi.testclient import TestClient
from backend.main import app, engine, _plan_week


def test_plan_versions_and_validation():
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)
    week = _plan_week(None)
    next_week = (date.fromisoformat(week) + timedelta(days=7)).isoformat()
    calf = {
        'name': 'Standing Calf Raise', 'sets': 3, 'targetReps': '12–20',
        'rest': '60–90 sec', 'cue': 'Lower under control',
        'substitutions': ['Calf Raise Machine', 'Calf Press on Leg Press'],
    }
    with TestClient(app) as client:
        # Production's pre-existing Journey route must survive source reconciliation.
        today = date.today().isoformat()
        journey = client.get('/journey', params={'startDate': today, 'endDate': today})
        assert journey.status_code == 200, journey.text
        initial = client.get('/workout-plan', params={'weekStart': week})
        assert initial.status_code == 200
        assert initial.json() == {'weekStart': week, 'revision': 0, 'overrides': {}}
        url = f'/workout-plan?weekStart={week}'
        payload = {'expectedRevision': 0, 'overrides': {'legs': [calf]}}
        assert client.put(url, json={'expectedRevision': 0, 'overrides': {'recovery': [calf]}}).status_code == 422
        assert client.put(url, json={'expectedRevision': 0, 'overrides': {'legs': [{**calf, 'sets': 0}]}}).status_code == 422
        assert client.put('/workout-plan?weekStart=2026-09-22', json=payload).status_code == 422
        changed = client.put(url, json=payload)
        assert changed.status_code == 200, changed.text
        assert changed.json()['revision'] == 1
        assert changed.json()['overrides']['legs'][0]['name'] == 'Standing Calf Raise'
        assert client.put(url, json=payload).status_code == 409
        assert client.get('/workout-plan', params={'weekStart': next_week}).json()['overrides']['legs'][0]['name'] == 'Standing Calf Raise'
        future = client.put(f'/workout-plan?weekStart={next_week}', json={
            'expectedRevision': 1, 'overrides': {'legs': [{**calf, 'targetReps': '10–15'}]},
        })
        assert future.status_code == 200, future.text
        assert future.json()['revision'] == 2
        assert client.get(url).json()['overrides']['legs'][0]['targetReps'] == '12–20'
        assert client.get(f'/workout-plan?weekStart={next_week}').json()['overrides']['legs'][0]['targetReps'] == '10–15'
        assert client.get('/workouts/').json() == []
