from datetime import datetime, timedelta, timezone

from backend.tests.test_workouts import reset_db
from backend.main import app, engine
from backend.health_v2_models import HealthSampleObservationDB
from fastapi.testclient import TestClient
from sqlmodel import Session


def test_cardio_analysis_persists_coverage_and_ignores_manual_hr():
    reset_db()
    start = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
    with TestClient(app) as client:
        response = client.post('/workouts/', json={
            'date': (start + timedelta(minutes=20)).isoformat(), 'durationMinutes': 20,
            'cardioSummary': {'durationMinutes': 20, 'avgHeartRate': 95},
            'exercises': [{'name': 'Treadmill · Benchmark 3 mph 7%', 'kind': 'cardio', 'sets': [],
                           'cardioDurationMinutes': 20, 'distanceMiles': 1, 'inclinePercent': 7}],
        })
        assert response.status_code == 201, response.text
        sid = response.json()['id']
        url = f'/workouts/{sid}/cardio-analysis'
        missing = client.post(url, json={'zoneLower': 110, 'zoneUpper': 130})
        assert missing.status_code == 200, missing.text
        assert missing.json()['cardioAnalysis']['benchmarkAverageHr'] is None
        assert missing.json()['cardioAnalysis']['source'] == 'none'
        samples = [{'time': (start + timedelta(minutes=i)).isoformat(), 'beatsPerMinute': 120}
                   for i in range(21)]
        analyzed = client.post(url, json={'zoneLower': 110, 'zoneUpper': 130, 'samples': samples})
        assert analyzed.status_code == 200, analyzed.text
        assert analyzed.json()['cardioAnalysis']['source'] == 'health-connect'
        assert analyzed.json()['cardioAnalysis']['zone2Minutes'] == 20
        assert analyzed.json()['cardioAnalysis']['benchmarkAverageHr'] == 120
        assert client.get(f'/workouts/{sid}').json()['cardioAnalysis'] == analyzed.json()['cardioAnalysis']
        assert client.post(url, json={'zoneLower': 130, 'zoneUpper': 110}).status_code == 422


def test_google_preferred_only_with_coverage_in_benchmark_late_window():
    reset_db()
    start = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
    with TestClient(app) as client:
        created = client.post('/workouts/', json={
            'date': (start + timedelta(minutes=20)).isoformat(), 'durationMinutes': 20,
            'exercises': [{'name': 'Treadmill · Benchmark 3 mph 7%', 'kind': 'cardio', 'sets': [],
                           'cardioDurationMinutes': 20, 'distanceMiles': 1, 'inclinePercent': 7}],
        })
        assert created.status_code == 201, created.text
        sid = created.json()['id']
        with Session(engine) as db:
            for i in range(17):
                db.add(HealthSampleObservationDB(
                    id=f'google-{i}', provenance='google_wearables_reconciled',
                    data_type='heart_rate', observed_at_utc=(start + timedelta(minutes=i)).isoformat(),
                    numeric_value=120, unit='bpm', payload_hash=f'hash-{i}', import_run_id='test-run',
                    ingested_at=start))
            db.commit()
        url = f'/workouts/{sid}/cardio-analysis'
        fallback = [{'time': (start + timedelta(minutes=i)).isoformat(), 'beatsPerMinute': 130}
                    for i in range(21)]
        result = client.post(url, json={'zoneLower': 110, 'zoneUpper': 130, 'samples': fallback})
        assert result.status_code == 200, result.text
        assert result.json()['cardioAnalysis']['source'] == 'health-connect'
        assert result.json()['cardioAnalysis']['benchmarkAverageHr'] == 130
        with Session(engine) as db:
            for i in range(17, 21):
                db.add(HealthSampleObservationDB(
                    id=f'google-{i}', provenance='google_wearables_reconciled',
                    data_type='heart_rate', observed_at_utc=(start + timedelta(minutes=i)).isoformat(),
                    numeric_value=120, unit='bpm', payload_hash=f'hash-{i}', import_run_id='test-run',
                    ingested_at=start))
            db.commit()
        result = client.post(url, json={'zoneLower': 110, 'zoneUpper': 130, 'samples': fallback})
        assert result.status_code == 200, result.text
        assert result.json()['cardioAnalysis']['source'] == 'google-health'
        assert result.json()['cardioAnalysis']['benchmarkAverageHr'] == 120


def test_coach_suppresses_cardio_fitness_claim_without_benchmark_pair(monkeypatch):
    reset_db()
    with TestClient(app) as client:
        created = client.post('/workouts/', json={
            'date': '2026-11-16T12:20:00Z', 'durationMinutes': 20,
            'exercises': [{'name': 'Elliptical', 'kind': 'cardio', 'sets': [], 'cardioDurationMinutes': 20}],
        })
        assert created.status_code == 201
        class Provider:
            def generate(self, prompt):
                assert 'current minutes 10–20 average HR = None' in prompt
                return ('{"headline":"Your cardiovascular fitness improved","verdict":"Treadmill HR is better now",'
                        '"wins":[],"caveat":"These sessions are not directly comparable",'
                        '"nextAction":{"title":"Next move","detail":"Continue cardio progress"},'
                        '"question":"How did this feel?","confidence":"high"}')
        monkeypatch.setattr('backend.main.get_coach_provider', lambda: Provider())
        result = client.post(f"/workouts/{created.json()['id']}/insight")
        assert result.status_code == 200, result.text
        card = result.json()['coachInsight']
        assert 'fitness improved' not in card['headline']
        assert 'HR is better' not in card['verdict']
        assert card['caveat'] is None
        assert 'cardio progress' not in card['nextAction']['detail']
