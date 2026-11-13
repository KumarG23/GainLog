from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session
from backend.health_hub import project
from backend.main import engine

EASTERN = ZoneInfo('America/New_York')


def test_supplements_configure_mark_edit_archive_and_projection(client):
    day = datetime.now(EASTERN).date().isoformat()
    assert client.get('/longevity/supplements').json()['adherence7'] is None
    created = client.post('/longevity/supplements', json={'name': 'Test item', 'dose': 'one unit', 'period': 'AM'})
    assert created.status_code == 201, created.text
    item = created.json()['id']
    initial = client.get('/longevity/supplements').json()
    assert initial['scheduled7'] == 1 and initial['adherence7'] == 0
    assert client.put(f'/longevity/supplements/{item}/taken/{day}', json={'taken': True}).status_code == 200
    assert client.put(f'/longevity/supplements/{item}/taken/{day}', json={'taken': True}).status_code == 200
    assert client.get('/longevity/supplements').json()['adherence7'] == 100
    assert client.put(f'/longevity/supplements/{item}', json={'name': 'Edited item', 'dose': 'two units', 'period': 'PM'}).status_code == 200
    assert client.get('/longevity/supplements').json()['items'][0]['dose'] == 'two units'
    tomorrow = (datetime.now(EASTERN).date() + timedelta(days=1)).isoformat()
    assert client.put(f'/longevity/supplements/{item}/taken/{tomorrow}', json={'taken': True}).status_code == 422
    with Session(engine) as db:
        rows = project(db)
    assert next(r for r in rows['Daily'] if r[0] == day)[23] == 100
    assert client.delete(f'/longevity/supplements/{item}').status_code == 204
    assert client.get('/longevity/supplements').json()['items'] == []
    assert client.get('/longevity/supplements').json()['adherence7'] == 100
    with Session(engine) as db:
        assert next(r for r in project(db)['Daily'] if r[0] == day)[23] == 100


def test_confirmed_meal_tags_and_full_day_week(client):
    today = datetime.now(EASTERN).date()
    week = (today - timedelta(days=today.weekday())).isoformat()
    day = today.isoformat()
    empty = client.get('/nutrition/quality/week', params={'weekStart': week}).json()
    assert empty['upfDinners'] is None and empty['daysLogged'] is None
    payload = {'date': f'{day}T19:00:00-05:00', 'meal': 'dinner', 'name': 'Pizza',
               'calories': 400, 'proteinG': 20, 'tags': ['ultra-processed']}
    first = client.post('/nutrition/', json=payload)
    assert first.status_code == 201, first.text
    item = first.json()['id']
    assert first.json()['tags'] == ['ultra-processed']
    assert client.patch(f'/nutrition/{item}', json={'tags': ['fatty-fish', 'EVOO']}).json()['tags'] == ['fatty-fish', 'EVOO']
    assert client.patch(f'/nutrition/{item}', json={'tags': ['unverified']}).status_code == 422
    assert client.get(f'/nutrition/{item}').json()['tags'] == ['fatty-fish', 'EVOO']
    assert client.get('/nutrition/quality/week', params={'weekStart': week}).json() == {
        'weekStart': week, 'weekEnd': (today + timedelta(days=6-today.weekday())).isoformat(),
        'upfDinners': 0, 'fattyFishMeals': 1, 'daysLogged': None}
    assert client.put(f'/nutrition/full-day/{day}', json={'confirmed': True}).status_code == 200
    assert client.get(f'/nutrition/full-day/{day}').json()['confirmed'] is True
    with Session(engine) as db:
        rows = project(db)
    daily = next(r for r in rows['Daily'] if r[0] == day)
    weekly = next(r for r in rows['Weekly'] if r[0] == week)
    assert daily[21:25] == ['', 'Y', '', 'Y']
    assert weekly[13] == 1 and weekly[17:20] == [0, 1, '']
    assert rows['Meals'][0][-1] == 'fatty-fish, EVOO'
    assert client.put(f'/nutrition/full-day/{day}', json={'confirmed': False}).status_code == 200
    assert client.get('/nutrition/quality/week', params={'weekStart': week}).json()['daysLogged'] == 0
    assert client.delete(f'/nutrition/{item}').status_code == 204
    assert client.get('/nutrition/quality/week', params={'weekStart': week}).json()['fattyFishMeals'] is None


def test_meal_counts_group_food_rows_and_use_eastern_dates():
    from types import SimpleNamespace
    from backend.meal_quality import meal_counts, local_day
    rows = [SimpleNamespace(date='2026-11-17T01:00:00Z', meal='Dinner', tags_json='["ultra-processed", "fatty-fish"]'),
            SimpleNamespace(date='2026-11-16T20:15:00-05:00', meal='dinner', tags_json='["ultra-processed", "fatty-fish"]')]
    assert local_day(rows[0].date) == '2026-11-16'
    assert meal_counts(rows) == (1, 1)

