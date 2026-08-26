from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet


def test_google_health_authorization_uses_exact_scopes_pkce_and_offline_consent():
    from backend.google_health import GOOGLE_HEALTH_SCOPES, build_authorization_url

    url, verifier = build_authorization_url("state-value", "client-id")

    assert GOOGLE_HEALTH_SCOPES == (
        "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    )
    assert verifier
    assert "state=state-value" in url
    assert "code_challenge=" in url
    assert "code_challenge_method=S256" in url
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "%20" in url


def test_google_health_token_cipher_round_trips_without_plaintext():
    from backend.google_health import TokenCipher

    cipher = TokenCipher(Fernet.generate_key().decode())
    encrypted = cipher.encrypt("refresh-token-for-test-only")

    assert "refresh-token-for-test-only" not in encrypted
    assert cipher.decrypt(encrypted) == "refresh-token-for-test-only"


def test_google_health_sleep_parser_deduplicates_identical_stages_and_maps_end_date():
    from backend.google_health import parse_sleep_summary

    summary = parse_sleep_summary({
        "endTime": "2026-08-26T07:30:00-04:00",
        "minutesAsleep": 440,
        "stagesSummary": [
            {"type": "LIGHT", "minutes": 259}, {"type": "LIGHT", "minutes": 259},
            {"type": "DEEP", "minutes": 82}, {"type": "REM", "minutes": 99},
            {"type": "AWAKE", "minutes": 55},
        ],
    })

    assert summary == {
        "date": "2026-08-26", "sleep_minutes": 440, "core_sleep_minutes": 259,
        "deep_sleep_minutes": 82, "rem_sleep_minutes": 99, "awake_minutes": 55,
    }


def test_google_health_sleep_parser_rejects_conflicting_duplicate_stage():
    from backend.google_health import GoogleHealthDataError, parse_sleep_summary

    with pytest.raises(GoogleHealthDataError, match="conflicting duplicate"):
        parse_sleep_summary({"endTime": "2026-08-26T07:30:00Z", "minutesAsleep": 440,
                             "stagesSummary": [{"type": "LIGHT", "minutes": 259}, {"type": "LIGHT", "minutes": 260}]})


def test_google_health_parses_reconciled_sleep_fixture_with_int64_strings():
    from backend.google_health import parse_reconciled_sleep

    parsed = parse_reconciled_sleep({
        "dataPointName": "users/me/dataTypes/sleep/dataPoints/sleep-1",
        "sleep": {
            "interval": {"endTime": "2026-08-26T07:30:00-04:00"},
            "metadata": {"mainSleep": True, "processed": True, "nap": False},
            "summary": {"minutesAsleep": "440", "minutesAwake": "55", "stagesSummary": [
                {"type": "LIGHT", "minutes": "259"}, {"type": "DEEP", "minutes": "82"},
                {"type": "REM", "minutes": "99"}, {"type": "AWAKE", "minutes": "55"},
            ]},
        },
    })

    assert parsed == {"date": "2026-08-26", "sleep_minutes": 440, "core_sleep_minutes": 259,
                      "deep_sleep_minutes": 82, "rem_sleep_minutes": 99, "awake_minutes": 55}


def test_google_health_sync_range_is_bounded_and_uses_closed_open_dates():
    from backend.google_health import google_health_sync_range

    assert google_health_sync_range(today=datetime(2026, 8, 26, tzinfo=timezone.utc).date()) == ("2026-08-20", "2026-08-27")
    with pytest.raises(ValueError):
        google_health_sync_range("2026-08-27", "2026-08-20", backfill=True)


def test_google_health_sync_rejects_unconnected_without_credentials(client):
    response = client.post("/integrations/google-health/sync", json={})

    assert response.status_code == 409
    assert "token" not in response.text.lower()


def test_oauth_state_is_expired_or_replayed_before_exchange(client, monkeypatch):
    from backend.main import GoogleHealthOAuthStateDB, engine
    from sqlmodel import Session

    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_ID", "fake-client")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    started = client.get("/integrations/google-health/oauth/start", follow_redirects=False)
    assert started.status_code == 307
    state = started.headers["location"].split("state=")[1].split("&")[0]
    with Session(engine) as session:
        row = session.get(GoogleHealthOAuthStateDB, state)
        row.expires_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        session.add(row); session.commit()
    expired = client.get(f"/integrations/google-health/oauth/callback?state={state}&code=fake")
    assert expired.status_code == 400
    assert "fake" not in expired.text


class _FakeResponse:
    def __init__(self, payload, *, ok=True, status_code=200):
        self._payload = payload
        self.ok = ok
        self.status_code = status_code

    def json(self):
        return self._payload


class _FakeGoogleHealthHttp:
    def __init__(self, *, empty=False):
        self.empty = empty
        self.posts = []
        self.gets = []

    @staticmethod
    def _kind(url):
        return url.split("/dataTypes/", 1)[1].split("/", 1)[0]

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        if url == "https://oauth2.googleapis.com/token":
            return _FakeResponse({"access_token": "ephemeral-access-token"})
        if self.empty:
            return _FakeResponse({"rollupDataPoints": []})
        kind = self._kind(url)
        values = {
            "steps": {"countSum": "8123"},
            "distance": {"millimetersSum": "6437376"},
            "active-energy-burned": {"kcalSum": 530.5},
            "total-calories": {"kcalSum": 2140.75},
        }
        return _FakeResponse({
            "rollupDataPoints": [{
                "civilStartTime": {"date": {"year": 2026, "month": 8, "day": 26}},
                "civilEndTime": {"date": {"year": 2026, "month": 8, "day": 27}},
                kind.replace("-energy-burned", "EnergyBurned").replace("total-calories", "totalCalories"): values[kind],
            }],
        })

    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        if self.empty:
            return _FakeResponse({"dataPoints": []})
        kind = self._kind(url)
        if kind == "sleep":
            points = [{
                "name": "users/me/dataTypes/sleep/dataPoints/nap-1",
                "sleep": {
                    "interval": {
                        "endTime": "2026-08-26T15:00:00-04:00",
                        "civilEndTime": {"date": {"year": 2026, "month": 8, "day": 26}},
                    },
                    "metadata": {"mainSleep": False, "processed": True, "nap": True},
                    "summary": {"minutesAsleep": "45"},
                },
            }, {
                "name": "users/me/dataTypes/sleep/dataPoints/main-1",
                "sleep": {
                    "interval": {
                        "endTime": "2026-08-26T07:30:00-04:00",
                        "civilEndTime": {"date": {"year": 2026, "month": 8, "day": 26}},
                    },
                    "metadata": {
                        "mainSleep": True,
                        "processed": True,
                        "nap": False,
                        "stagesStatus": "SUCCEEDED",
                    },
                    "summary": {
                        "minutesAsleep": "440",
                        "minutesAwake": "55",
                        "stagesSummary": [
                            {"type": "LIGHT", "minutes": "259"},
                            {"type": "DEEP", "minutes": "82"},
                            {"type": "REM", "minutes": "99"},
                            {"type": "AWAKE", "minutes": "55"},
                        ],
                    },
                },
            }]
        elif kind == "daily-heart-rate-variability":
            points = [{"dailyHeartRateVariability": {
                "date": {"year": 2026, "month": 8, "day": 26},
                "averageHeartRateVariabilityMilliseconds": 42.5,
            }}]
        elif kind == "daily-resting-heart-rate":
            points = [{"dailyRestingHeartRate": {
                "date": {"year": 2026, "month": 8, "day": 26},
                "beatsPerMinute": "54",
            }}]
        else:
            exercise = {
                "dataPointName": "users/me/dataTypes/exercise/dataPoints/workout-1",
                "exercise": {
                    "interval": {
                        "civilEndTime": {"date": {"year": 2026, "month": 8, "day": 26}},
                    },
                    "activeDuration": "2100s",
                },
            }
            points = [exercise, exercise]
        return _FakeResponse({"dataPoints": points})


def _connect_google_health(monkeypatch):
    from backend.google_health import TokenCipher
    from backend.main import GoogleHealthConnectionDB, engine
    from sqlmodel import Session

    key = Fernet.generate_key().decode()
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_ID", "fake-client")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY", key)
    with Session(engine) as db:
        db.add(GoogleHealthConnectionDB(
            encrypted_refresh_token=TokenCipher(key).encrypt("fake-refresh-token"),
            status="connected",
        ))
        db.commit()


def test_google_health_sync_matches_v4_transport_and_persists_authoritative_metrics(client, monkeypatch):
    from backend.google_health import GOOGLE_WEARABLES, sync_google_health
    from backend.main import AppleHealthDailyDB, GoogleHealthDailySnapshotDB, engine
    from sqlmodel import Session

    _connect_google_health(monkeypatch)
    http = _FakeGoogleHealthHttp()
    with Session(engine) as db:
        result = sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=http,
        )
        daily = db.get(AppleHealthDailyDB, "2026-08-26")
        snapshot = db.get(GoogleHealthDailySnapshotDB, "2026-08-26")

    assert result == {"synced_days": 1, "start_date": "2026-08-26", "end_date": "2026-08-27"}
    assert daily.source == "google-health"
    assert daily.sleep_minutes == 440
    assert daily.core_sleep_minutes == 259
    assert daily.deep_sleep_minutes == 82
    assert daily.rem_sleep_minutes == 99
    assert daily.awake_minutes == 55
    assert daily.hrv_ms == 42.5
    assert daily.resting_heart_rate_bpm == 54
    assert daily.steps == 8123
    assert daily.walking_running_miles == pytest.approx(4.0)
    assert daily.active_calories == 530.5
    assert daily.total_calories == 2140.75
    assert daily.exercise_minutes == 35
    assert snapshot.sleep_minutes == 440

    rollup_calls = [call for call in http.posts if "dailyRollUp" in call[0]]
    assert len(rollup_calls) == 4
    for _, call in rollup_calls:
        assert call["json"]["dataSourceFamily"] == GOOGLE_WEARABLES
        assert call["json"]["windowSizeDays"] == 1
        assert "pageSize" not in call["json"]
        assert call["json"]["range"] == {
            "start": {"date": {"year": 2026, "month": 8, "day": 26}},
            "end": {"date": {"year": 2026, "month": 8, "day": 27}},
        }
    assert len(http.gets) == 4
    assert all(call[1]["params"]["dataSourceFamily"] == GOOGLE_WEARABLES for call in http.gets)
    exercise_call = next(call for call in http.gets if "/dataTypes/exercise/" in call[0])
    assert exercise_call[1]["params"]["filter"] == (
        'exercise.interval.civil_start_time >= "2026-08-25" '
        'AND exercise.interval.civil_start_time < "2026-08-27"'
    )

    replaced = client.post("/health-connect/daily/import", json={
        "date": "2026-08-26",
        "sleepMinutes": 1,
        "steps": 1,
        "replaceExisting": True,
        "source": "health-connect",
    })
    assert replaced.status_code == 200
    assert replaced.json()["sleepMinutes"] == 440
    assert replaced.json()["steps"] == 8123
    assert replaced.json()["source"] == "google-health"


def test_google_health_empty_day_does_not_erase_health_connect_fallback(client, monkeypatch):
    from backend.google_health import sync_google_health
    from backend.main import AppleHealthDailyDB, GoogleHealthDailySnapshotDB, engine
    from sqlmodel import Session

    created = client.post("/health-connect/daily/import", json={
        "date": "2026-08-26",
        "sleepMinutes": 422,
        "steps": 7000,
        "source": "health-connect",
    })
    assert created.status_code == 201
    _connect_google_health(monkeypatch)

    with Session(engine) as db:
        sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=_FakeGoogleHealthHttp(empty=True),
        )
        daily = db.get(AppleHealthDailyDB, "2026-08-26")
        snapshot = db.get(GoogleHealthDailySnapshotDB, "2026-08-26")

    assert daily.sleep_minutes == 422
    assert daily.steps == 7000
    assert daily.source == "health-connect"
    assert snapshot is None


def test_successful_empty_reconcile_clears_prior_google_metrics(client, monkeypatch):
    from backend.google_health import sync_google_health
    from backend.main import AppleHealthDailyDB, GoogleHealthDailySnapshotDB, engine
    from sqlmodel import Session

    _connect_google_health(monkeypatch)
    with Session(engine) as db:
        sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=_FakeGoogleHealthHttp(),
        )
        result = sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=_FakeGoogleHealthHttp(empty=True),
        )
        daily = db.get(AppleHealthDailyDB, "2026-08-26")
        snapshot = db.get(GoogleHealthDailySnapshotDB, "2026-08-26")

    assert result["synced_days"] == 1
    assert daily is None
    assert snapshot is None


def test_google_health_oauth_callback_encrypts_refresh_token_and_rejects_replay(client, monkeypatch):
    from backend.google_health import GOOGLE_HEALTH_SCOPES, TokenCipher
    from backend.main import GoogleHealthConnectionDB, engine
    from sqlmodel import Session

    key = Fernet.generate_key().decode()
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_ID", "fake-client")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("GAINLOG_GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY", key)
    exchanges = []

    def exchange(url, **kwargs):
        exchanges.append((url, kwargs))
        return _FakeResponse({"refresh_token": "fake-refresh-token"})

    monkeypatch.setattr("backend.main.requests.post", exchange)
    started = client.get("/integrations/google-health/oauth/start", follow_redirects=False)
    query = parse_qs(urlparse(started.headers["location"]).query)
    state = query["state"][0]
    assert query["scope"][0].split() == list(GOOGLE_HEALTH_SCOPES)
    assert query["access_type"] == ["offline"]
    assert query["prompt"] == ["consent"]

    completed = client.get(
        f"/integrations/google-health/oauth/callback?state={state}&code=fake-code"
    )
    replayed = client.get(
        f"/integrations/google-health/oauth/callback?state={state}&code=fake-code"
    )

    assert completed.status_code == 200
    assert replayed.status_code == 400
    assert len(exchanges) == 1
    assert "fake-code" not in completed.text
    assert "fake-refresh-token" not in completed.text
    with Session(engine) as db:
        connection = db.get(GoogleHealthConnectionDB, "primary")
    assert connection.status == "connected"
    assert "fake-refresh-token" not in connection.encrypted_refresh_token
    assert TokenCipher(key).decrypt(connection.encrypted_refresh_token) == "fake-refresh-token"


def test_google_health_disconnect_revokes_best_effort_and_removes_local_credential(client, monkeypatch):
    from backend.main import GoogleHealthConnectionDB, engine
    from sqlmodel import Session

    _connect_google_health(monkeypatch)
    revocations = []

    def revoke(url, **kwargs):
        revocations.append((url, kwargs))
        return _FakeResponse({})

    monkeypatch.setattr("backend.main.requests.post", revoke)
    disconnected = client.delete("/integrations/google-health/connection")
    disconnected_again = client.delete("/integrations/google-health/connection")

    assert disconnected.status_code == 204
    assert disconnected_again.status_code == 204
    assert len(revocations) == 1
    assert revocations[0][0] == "https://oauth2.googleapis.com/revoke"
    with Session(engine) as db:
        assert db.get(GoogleHealthConnectionDB, "primary") is None


def test_disconnect_releases_google_precedence_to_health_connect(client, monkeypatch):
    from backend.google_health import sync_google_health
    from backend.main import GoogleHealthConnectionDB, engine
    from sqlmodel import Session

    _connect_google_health(monkeypatch)
    with Session(engine) as db:
        sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=_FakeGoogleHealthHttp(),
        )

    monkeypatch.setattr(
        "backend.main.requests.post",
        lambda *_args, **_kwargs: _FakeResponse({}),
    )
    assert client.delete("/integrations/google-health/connection").status_code == 204

    imported = client.post(
        "/health-connect/daily/import",
        json={
            "date": "2026-08-26",
            "steps": 4321,
            "replaceExisting": True,
            "source": "health-connect",
        },
    )

    assert imported.status_code == 200
    assert imported.json()["steps"] == 4321
    assert imported.json()["source"] == "health-connect"
    with Session(engine) as db:
        assert db.get(GoogleHealthConnectionDB, "primary") is None


def test_google_health_refresh_rejection_marks_connection_for_reauthorization(client, monkeypatch):
    from backend.google_health import GoogleHealthDataError, sync_google_health
    from backend.main import GoogleHealthConnectionDB, engine
    from sqlmodel import Session

    _connect_google_health(monkeypatch)

    class UnauthorizedHttp:
        @staticmethod
        def post(_url, **_kwargs):
            return _FakeResponse({}, ok=False, status_code=401)

    with Session(engine) as db:
        with pytest.raises(GoogleHealthDataError, match="synchronization failed"):
            sync_google_health(
                db,
                start_date="2026-08-26",
                end_date="2026-08-27",
                http=UnauthorizedHttp(),
            )
        connection = db.get(GoogleHealthConnectionDB, "primary")

    assert connection.status == "needs_reauthorization"
    assert connection.last_error == "Google Health authorization needs reconnection"


def test_google_health_partial_day_preserves_health_connect_fallback_fields(client, monkeypatch):
    from backend.google_health import sync_google_health
    from backend.main import AppleHealthDailyDB, engine
    from sqlmodel import Session

    class StepsOnlyHttp(_FakeGoogleHealthHttp):
        def post(self, url, **kwargs):
            if url == "https://oauth2.googleapis.com/token" or "/dataTypes/steps/" in url:
                return super().post(url, **kwargs)
            self.posts.append((url, kwargs))
            return _FakeResponse({"rollupDataPoints": []})

        def get(self, url, **kwargs):
            self.gets.append((url, kwargs))
            return _FakeResponse({"dataPoints": []})

    created = client.post("/health-connect/daily/import", json={
        "date": "2026-08-26",
        "sleepMinutes": 422,
        "steps": 7000,
        "source": "health-connect",
    })
    assert created.status_code == 201
    _connect_google_health(monkeypatch)
    with Session(engine) as db:
        sync_google_health(
            db,
            start_date="2026-08-26",
            end_date="2026-08-27",
            http=StepsOnlyHttp(),
        )

    replaced = client.post("/health-connect/daily/import", json={
        "date": "2026-08-26",
        "sleepMinutes": 430,
        "steps": 1,
        "replaceExisting": True,
        "source": "health-connect",
    })
    assert replaced.status_code == 200
    assert replaced.json()["sleepMinutes"] == 430
    assert replaced.json()["steps"] == 8123
    assert replaced.json()["source"] == "google-health"
    with Session(engine) as db:
        daily = db.get(AppleHealthDailyDB, "2026-08-26")
    assert daily.sleep_minutes == 430
    assert daily.steps == 8123
