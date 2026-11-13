import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session
from backend.main import AppleHealthDailyDB, WeeklyReviewDB, WorkoutSessionDB, ExerciseDB, engine
from backend.weekly_scorecard import build
from backend.health_hub import project


def week():
    today = datetime.now(ZoneInfo('America/New_York')).date()
    return today - timedelta(days=today.weekday()+7)


def test_missing_scorecard_and_save_preserve_existing_review(client):
    start = week()
    response = client.get('/longevity/scorecard', params={'weekStart': start.isoformat()})
    assert response.status_code == 200, response.text
    card = response.json()
    assert len(card['rows']) == 17
    assert all(row['value'] is None and row['status'] == 'amber' for row in card['rows'])
    end = (start+timedelta(days=6)).isoformat()
    with Session(engine) as db:
        db.add(WeeklyReviewDB(week_start=start.isoformat(), week_end=end, review='Keep existing prose', generated_at='original'))
        db.commit()
    saved = client.post('/longevity/scorecard/save', params={'weekStart': start.isoformat()})
    assert saved.status_code == 200, saved.text
    with Session(engine) as db:
        row = db.get(WeeklyReviewDB, end)
        assert row.review == 'Keep existing prose' and row.generated_at == 'original'
        assert row.one_change and json.loads(row.scorecard_json)['rows'] == card['rows']
        assert next(r for r in project(db)['Weekly'] if r[0] == start.isoformat())[-1] == row.one_change
    reloaded = client.get('/longevity/scorecard', params={'weekStart': start.isoformat()}).json()
    assert reloaded['savedAt'] and reloaded['savedSnapshot']['rows'] == card['rows']
    assert client.get('/longevity/scorecard', params={'weekStart': (start+timedelta(days=1)).isoformat()}).status_code == 422


def test_scorecard_excludes_partial_nutrition_and_counts_performed_intervals(client):
    start = week()
    day = start.isoformat()
    entry = client.post('/nutrition/', json={'date': day+'T19:00:00-05:00', 'meal':'dinner', 'name':'Test meal', 'calories':500, 'proteinG':35, 'fiberG':10})
    assert entry.status_code == 201
    with Session(engine) as db:
        db.add(AppleHealthDailyDB(date=day, sleep_minutes=450, steps=9000, updated_at=day))
        workout = WorkoutSessionDB(date=day+'T12:00:00-05:00', duration_minutes=10, template_id='recovery', cardio_duration_minutes=10)
        db.add(workout); db.flush()
        db.add(ExerciseDB(session_id=workout.id, name='Treadmill · Hard interval 1', kind='cardio', cardio_duration_minutes=4, position=0))
        db.commit()
        rows = {r['key']: r for r in build(db, start)['rows']}
        assert rows['sleep']['value'] == 7.5
        assert rows['protein']['value'] is None
        assert rows['intervals']['value'] == 1
        assert rows['zone2']['value'] is None
    assert client.put('/nutrition/full-day/'+day, json={'confirmed':True}).status_code == 200
    rows = {r['key']:r for r in client.get('/longevity/scorecard', params={'weekStart':day}).json()['rows']}
    assert rows['protein']['value'] == 35 and rows['protein']['status'] == 'red'
    assert rows['logged']['value'] == 1
