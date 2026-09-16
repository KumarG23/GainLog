from __future__ import annotations

from datetime import date, timedelta
import uuid

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from backend.google_health_v2 import GoogleHealthV2Importer
from backend.health_v2_models import (
    HealthDailyMetricDB,
    HealthDataQualityDB,
    HealthImportRunDB,
    HealthIntervalObservationDB,
    HealthSampleObservationDB,
    HealthSleepEventDB,
    HealthSleepSessionDB,
    HealthSleepStageDB,
    HealthSourceDB,
)
from backend.main import AppleHealthDailyDB


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = ""

    def json(self) -> dict:
        return self._payload


class FakeGoogleHealth:
    def __init__(self, responses: dict[tuple[str, str, str | None], dict]):
        self.responses = responses
        self.calls: list[dict] = []

    @staticmethod
    def _key(url: str, params: dict) -> tuple[str, str, str | None]:
        data_type = url.split("/dataTypes/", 1)[1].split("/dataPoints", 1)[0]
        if url.endswith(":reconcile"):
            family = params["dataSourceFamily"].rsplit("/", 1)[-1]
            provenance = (
                "google_wearables_reconciled"
                if family == "google-wearables"
                else "google_all_sources_reconciled"
            )
        else:
            provenance = "source_raw"
        return data_type, provenance, params.get("pageToken")

    def get(self, url: str, *, headers: dict, params: dict, timeout: int):
        assert headers == {"Authorization": "Bearer test-token"}
        assert params["pageSize"] == 1000
        assert timeout == 30
        if url.endswith(":reconcile"):
            assert "/dataSourceFamilies/" not in url
            assert params["dataSourceFamily"] in {
                "users/me/dataSourceFamilies/google-wearables",
                "users/me/dataSourceFamilies/all-sources",
            }
        key = self._key(url, params)
        self.calls.append({"key": key, "page_size": params["pageSize"]})
        return FakeResponse(self.responses.get(key, {"dataPoints": []}))


def civil(year: int, month: int, day: int, hour: int, minute: int, offset: int = -14_400):
    return {
        "date": {"year": year, "month": month, "day": day},
        "time": {"hour": hour, "minute": minute, "second": 0},
        "utcOffset": f"{offset}s",
    }


def instant(physical: str, civil_time: dict) -> dict:
    return {
        "physicalTime": physical,
        "civilTime": civil_time,
        "utcOffset": civil_time.get("utcOffset", "-14400s"),
    }


def interval(
    start_physical: str,
    end_physical: str,
    start_civil: dict,
    end_civil: dict,
) -> dict:
    return {
        "startTime": start_physical,
        "endTime": end_physical,
        "startUtcOffset": start_civil.get("utcOffset", "-14400s"),
        "endUtcOffset": end_civil.get("utcOffset", "-14400s"),
        "civilStartTime": start_civil,
        "civilEndTime": end_civil,
    }


def source(identity: str, device_name: str = "Pixel Watch 5") -> dict:
    return {
        "dataSourceId": identity,
        "application": {"packageName": "com.google.android.apps.fitness"},
        "device": {"displayName": device_name, "formFactor": "WATCH"},
    }


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def base_responses() -> dict[tuple[str, str, str | None], dict]:
    day = civil(2026, 9, 2, 8, 0)
    day_2 = civil(2026, 9, 2, 8, 1)
    sleep_interval = interval(
        "2026-09-03T02:00:00Z",
        "2026-09-03T10:00:00Z",
        civil(2026, 9, 2, 22, 0),
        civil(2026, 9, 3, 6, 0),
    )
    stage_interval = interval(
        "2026-09-03T02:30:00Z",
        "2026-09-03T03:00:00Z",
        civil(2026, 9, 2, 22, 30),
        civil(2026, 9, 2, 23, 0),
    )
    awakening = interval(
        "2026-09-03T05:00:00Z",
        "2026-09-03T05:02:00Z",
        civil(2026, 9, 3, 1, 0),
        civil(2026, 9, 3, 1, 2),
    )
    out_of_bed = interval(
        "2026-09-03T08:00:00Z",
        "2026-09-03T08:05:00Z",
        civil(2026, 9, 3, 4, 0),
        civil(2026, 9, 3, 4, 5),
    )
    sleep = {
        "name": "sleep/night-1",
        "dataSource": source("fitbit-watch"),
        "createTime": "2026-09-03T11:00:00Z",
        "updateTime": "2026-09-03T11:10:00Z",
        "sleep": {
            "interval": sleep_interval,
            "type": "STAGES",
            "metadata": {"mainSleep": True},
            "stages": [{**stage_interval, "type": "DEEP"}],
            "shortAwakenings": [awakening],
            "outOfBedSegments": [out_of_bed],
            "summary": {
                "minutesAsleep": 450,
                "minutesAwake": 30,
                "minutesInSleepPeriod": 480,
                "minutesToFallAsleep": 15,
                "minutesAfterWakeUp": 5,
            },
        },
    }
    return {
        ("heart-rate", "source_raw", None): {
            "dataPoints": [
                {
                    "name": "hr/1",
                    "dataSource": source("fitbit-watch"),
                    "heartRate": {
                        "sampleTime": instant("2026-09-02T12:00:00Z", day),
                        "beatsPerMinute": 70,
                    },
                },
                {
                    "name": "hr/2",
                    "dataSource": source("fitbit-watch"),
                    "heartRate": {
                        "sampleTime": instant("2026-09-02T12:01:00Z", day_2),
                        "beatsPerMinute": 72,
                    },
                },
            ],
            "nextPageToken": "p2",
        },
        ("heart-rate", "source_raw", "p2"): {
            "dataPoints": [
                {
                    "name": "hr/3",
                    "dataSource": source("fitbit-watch"),
                    "heartRate": {
                        "sampleTime": instant(
                            "2026-09-02T18:00:00Z", civil(2026, 9, 2, 14, 0)
                        ),
                        "beatsPerMinute": 80,
                    },
                }
            ]
        },
        ("heart-rate-variability", "source_raw", None): {
            "dataPoints": [
                {
                    "name": "hrv/1",
                    "dataSource": source("fitbit-watch"),
                    "heartRateVariability": {
                        "sampleTime": instant(
                            "2026-09-03T06:00:00Z", civil(2026, 9, 3, 2, 0)
                        ),
                        "rootMeanSquareOfSuccessiveDifferencesMilliseconds": 42.5,
                        "standardDeviationMilliseconds": 51.0,
                    },
                }
            ]
        },
        ("oxygen-saturation", "source_raw", None): {
            "dataPoints": [
                {
                    "name": "spo2/1",
                    "dataSource": source("fitbit-watch"),
                    "oxygenSaturation": {
                        "sampleTime": instant(
                            "2026-09-03T06:05:00Z", civil(2026, 9, 3, 2, 5)
                        ),
                        "percentage": 96.5,
                    },
                }
            ]
        },
        ("steps", "source_raw", None): {
            "dataPoints": [
                {
                    "name": "steps/watch",
                    "dataSource": source("fitbit-watch"),
                    "steps": {
                        "interval": interval(
                            "2026-09-02T12:00:00Z",
                            "2026-09-02T13:00:00Z",
                            civil(2026, 9, 2, 8, 0),
                            civil(2026, 9, 2, 9, 0),
                        ),
                        "count": 1000,
                    },
                },
                {
                    "name": "steps/phone",
                    "dataSource": source("health-connect-phone", "Pixel 11"),
                    "steps": {
                        "interval": interval(
                            "2026-09-02T12:00:00Z",
                            "2026-09-02T13:00:00Z",
                            civil(2026, 9, 2, 8, 0),
                            civil(2026, 9, 2, 9, 0),
                        ),
                        "count": 1200,
                    },
                },
            ]
        },
        ("steps", "google_wearables_reconciled", None): {
            "dataPoints": [
                {
                    "name": "steps/wearable/reconciled",
                    "steps": {
                        "interval": interval(
                            "2026-09-02T12:00:00Z",
                            "2026-09-02T13:00:00Z",
                            civil(2026, 9, 2, 8, 0),
                            civil(2026, 9, 2, 9, 0),
                        ),
                        "count": 950,
                    },
                }
            ]
        },
        ("steps", "google_all_sources_reconciled", None): {
            "dataPoints": [
                {
                    "name": "steps/all/reconciled",
                    "steps": {
                        "interval": interval(
                            "2026-09-02T12:00:00Z",
                            "2026-09-02T13:00:00Z",
                            civil(2026, 9, 2, 8, 0),
                            civil(2026, 9, 2, 9, 0),
                        ),
                        "count": 1100,
                    },
                }
            ]
        },
        ("sleep", "source_raw", None): {"dataPoints": [sleep]},
        ("sleep", "google_wearables_reconciled", None): {
            "dataPoints": [{**sleep, "dataSource": None}]
        },
        ("daily-resting-heart-rate", "google_wearables_reconciled", None): {
            "dataPoints": [
                {
                    "name": "rhr/day-1",
                    "dailyRestingHeartRate": {
                        "date": {"year": 2026, "month": 9, "day": 2},
                        "beatsPerMinute": 58,
                    },
                }
            ]
        },
    }


def run_import(db: Session, responses: dict, start: date, end: date):
    run = HealthImportRunDB(
        id=str(uuid.uuid4()),
        requested_start=start.isoformat(),
        requested_end=end.isoformat(),
        started_at="2026-09-16T00:00:00Z",
        status="running",
    )
    db.add(run)
    db.commit()
    importer = GoogleHealthV2Importer(
        db,
        FakeGoogleHealth(responses),
        "test-token",
        run,
        start.isoformat(),
        end.isoformat(),
    )
    importer.run_all()
    run.status = "complete"
    run.complete = True
    db.add(run)
    db.commit()
    return {
        "run_id": run.id,
        "status": run.status,
        "inserted": run.records_inserted,
        "updated": run.records_updated,
        "unchanged": run.records_unchanged,
    }


def test_import_is_streamed_paginated_idempotent_and_preserves_provenance(db: Session):
    db.add(
        AppleHealthDailyDB(
            date="2026-09-02", steps=900, updated_at="2026-09-03T00:00:00Z"
        )
    )
    db.commit()
    responses = base_responses()

    http = FakeGoogleHealth(responses)
    run = HealthImportRunDB(
        id=str(uuid.uuid4()),
        requested_start="2026-09-02",
        requested_end="2026-09-04",
        started_at="2026-09-16T00:00:00Z",
        status="running",
    )
    db.add(run)
    db.commit()
    importer = GoogleHealthV2Importer(
        db, http, "test-token", run, "2026-09-02", "2026-09-04"
    )
    importer.run_all()
    run.status = "complete"
    run.complete = True
    db.add(run)
    db.commit()
    first = {
        "run_id": run.id,
        "status": run.status,
        "inserted": run.records_inserted,
    }

    assert first["status"] == "complete"
    assert first["inserted"] > 0
    assert len([c for c in http.calls if c["key"][0] == "heart-rate"]) == 2
    assert all(call["page_size"] == 1000 for call in http.calls)

    run = db.get(HealthImportRunDB, first["run_id"])
    assert run is not None
    assert run.max_page_records == 2
    assert run.pages_processed == run.api_calls
    assert run.peak_memory_kb > 0

    assert len(db.exec(select(HealthSampleObservationDB)).all()) == 6
    step_rows = db.exec(
        select(HealthIntervalObservationDB).where(
            HealthIntervalObservationDB.data_type == "steps"
        )
    ).all()
    assert len(step_rows) == 4
    assert {row.provenance for row in step_rows} == {
        "source_raw",
        "google_wearables_reconciled",
        "google_all_sources_reconciled",
    }
    assert len({row.source_id for row in step_rows if row.provenance == "source_raw"}) == 2
    sources = db.exec(select(HealthSourceDB)).all()
    assert any(row.device_name == "Pixel Watch 5" for row in sources)
    assert any(row.device_name == "Pixel 11" for row in sources)
    assert any(row.application_id == "com.google.android.apps.fitness" for row in sources)

    metrics = db.exec(
        select(HealthDailyMetricDB).where(HealthDailyMetricDB.metric == "steps")
    ).all()
    values = {(row.provenance, row.numeric_value) for row in metrics}
    assert ("google_wearables_reconciled", 950.0) in values
    assert ("google_all_sources_reconciled", 1100.0) in values
    assert ("gainlog_current_canonical", 900.0) in values
    assert ("source_raw", 1000.0) in values
    assert ("source_raw", 1200.0) in values

    counts_before = {
        "samples": len(db.exec(select(HealthSampleObservationDB)).all()),
        "intervals": len(db.exec(select(HealthIntervalObservationDB)).all()),
        "sessions": len(db.exec(select(HealthSleepSessionDB)).all()),
        "metrics": len(db.exec(select(HealthDailyMetricDB)).all()),
    }
    second = run_import(db, responses, date(2026, 9, 2), date(2026, 9, 4))
    assert second["inserted"] == 0
    assert second["updated"] == 0
    assert second["unchanged"] > 0
    assert counts_before == {
        "samples": len(db.exec(select(HealthSampleObservationDB)).all()),
        "intervals": len(db.exec(select(HealthIntervalObservationDB)).all()),
        "sessions": len(db.exec(select(HealthSleepSessionDB)).all()),
        "metrics": len(db.exec(select(HealthDailyMetricDB)).all()),
    }


def test_provider_update_replaces_existing_point_without_duplicate(db: Session):
    responses = base_responses()
    run_import(db, responses, date(2026, 9, 2), date(2026, 9, 4))

    updated = base_responses()
    updated[("heart-rate", "source_raw", None)]["dataPoints"][0]["heartRate"][
        "beatsPerMinute"
    ] = 75
    result = run_import(db, updated, date(2026, 9, 2), date(2026, 9, 4))

    points = db.exec(
        select(HealthSampleObservationDB).where(
            HealthSampleObservationDB.provider_point_id == "hr/1"
        )
    ).all()
    assert len(points) == 1
    assert points[0].numeric_value == 75
    assert result["updated"] >= 1


def test_unnamed_same_timestamp_points_do_not_overwrite_and_missing_points_tombstone(db: Session):
    sample_time = instant("2026-09-02T12:00:00Z", civil(2026, 9, 2, 8, 0))
    responses = base_responses()
    responses[("heart-rate", "source_raw", None)] = {
        "dataPoints": [
            {
                "dataSource": source("fitbit-watch"),
                "heartRate": {"sampleTime": sample_time, "beatsPerMinute": value},
            }
            for value in (60, 61)
        ]
    }
    run_import(db, responses, date(2026, 9, 2), date(2026, 9, 4))

    first_points = db.exec(
        select(HealthSampleObservationDB).where(
            HealthSampleObservationDB.data_type == "heart_rate",
            HealthSampleObservationDB.observed_at_utc == "2026-09-02T12:00:00Z",
        )
    ).all()
    assert len(first_points) == 2
    assert {row.numeric_value for row in first_points} == {60.0, 61.0}

    corrected = base_responses()
    corrected[("heart-rate", "source_raw", None)] = {
        "dataPoints": [
            {
                "dataSource": source("fitbit-watch"),
                "heartRate": {"sampleTime": sample_time, "beatsPerMinute": 62},
            }
        ]
    }
    run_import(db, corrected, date(2026, 9, 2), date(2026, 9, 4))

    all_points = db.exec(
        select(HealthSampleObservationDB).where(
            HealthSampleObservationDB.data_type == "heart_rate",
            HealthSampleObservationDB.observed_at_utc == "2026-09-02T12:00:00Z",
        )
    ).all()
    active = [row for row in all_points if not row.is_deleted]
    assert len(all_points) == 3
    assert len(active) == 1
    assert active[0].numeric_value == 62.0
    assert active[0].provider_point_id is None


def test_sleep_crosses_midnight_preserves_offsets_stages_and_events(db: Session):
    responses = base_responses()
    # Add a nap on the following afternoon, still distinct from main sleep.
    nap = {
        "name": "sleep/nap-1",
        "dataSource": source("fitbit-watch"),
        "sleep": {
            "interval": interval(
                "2026-09-03T18:00:00Z",
                "2026-09-03T18:30:00Z",
                civil(2026, 9, 3, 14, 0),
                civil(2026, 9, 3, 14, 30),
            ),
            "type": "STAGES",
            "metadata": {"mainSleep": False, "nap": True},
            "stages": [],
            "shortAwakenings": [],
            "outOfBedSegments": [],
        },
    }
    responses[("sleep", "source_raw", None)]["dataPoints"].append(nap)
    run_import(db, responses, date(2026, 9, 2), date(2026, 9, 4))

    sessions = db.exec(
        select(HealthSleepSessionDB).where(
            HealthSleepSessionDB.provenance == "source_raw"
        )
    ).all()
    main = next(row for row in sessions if row.provider_point_id == "sleep/night-1")
    nap_row = next(row for row in sessions if row.provider_point_id == "sleep/nap-1")
    assert main.local_start_date == "2026-09-02"
    assert main.local_end_date == "2026-09-03"
    assert main.start_offset_seconds == -14_400
    assert main.end_offset_seconds == -14_400
    assert main.is_main_sleep is True
    assert main.is_nap is False
    assert nap_row.is_nap is True
    assert nap_row.is_main_sleep is False
    assert len(db.exec(select(HealthSleepStageDB)).all()) == 2
    events = db.exec(select(HealthSleepEventDB)).all()
    assert {event.event_type for event in events} == {
        "SHORT_AWAKENING",
        "OUT_OF_BED",
    }


def test_failed_second_page_keeps_bounded_first_page_for_safe_retry(db: Session):
    class FailsOnSecondPage(FakeGoogleHealth):
        def get(self, url: str, *, headers: dict, params: dict, timeout: int):
            if params.get("pageToken") == "p2":
                raise TimeoutError("synthetic page failure")
            return super().get(url, headers=headers, params=params, timeout=timeout)

    run = HealthImportRunDB(
        id=str(uuid.uuid4()),
        requested_start="2026-09-02",
        requested_end="2026-09-04",
        started_at="2026-09-16T00:00:00Z",
        status="running",
    )
    db.add(run)
    db.commit()
    importer = GoogleHealthV2Importer(
        db,
        FailsOnSecondPage(base_responses()),
        "test-token",
        run,
        "2026-09-02",
        "2026-09-04",
    )
    with pytest.raises(TimeoutError):
        importer.run_all()

    # Page one was committed before the failed request; the stable point IDs
    # make replaying the whole endpoint safe instead of requiring a fragile token.
    assert len(db.exec(select(HealthSampleObservationDB)).all()) == 2
    saved_run = db.get(HealthImportRunDB, run.id)
    assert saved_run is not None
    assert saved_run.pages_processed == 1
    assert saved_run.max_page_records == 2


def test_quality_flags_partial_days_and_missing_hr_coverage(db: Session):
    today = date.today()
    tomorrow = today + timedelta(days=1)
    result = run_import(db, {}, today, tomorrow)
    assert result["status"] == "complete"

    rows = db.exec(
        select(HealthDataQualityDB).where(HealthDataQualityDB.date == today.isoformat())
    ).all()
    assert rows
    assert all(row.is_partial_day for row in rows)
    hr = next(row for row in rows if row.metric == "heart_rate")
    assert hr.status == "partial"
    assert hr.observed_count == 0
    assert hr.coverage_ratio == 0


def test_dst_offsets_are_preserved_not_rederived(db: Session):
    responses = base_responses()
    dst_sleep = responses[("sleep", "source_raw", None)]["dataPoints"][0]
    dst_sleep["name"] = "sleep/dst"
    dst_sleep["sleep"]["interval"] = interval(
        "2026-11-01T04:30:00Z",
        "2026-11-01T11:30:00Z",
        civil(2026, 11, 1, 0, 30, -14_400),
        civil(2026, 11, 1, 6, 30, -18_000),
    )
    responses[("sleep", "google_wearables_reconciled", None)]["dataPoints"] = []
    run_import(db, responses, date(2026, 11, 1), date(2026, 11, 2))

    row = db.exec(
        select(HealthSleepSessionDB).where(
            HealthSleepSessionDB.provider_point_id == "sleep/dst"
        )
    ).one()
    assert row.start_offset_seconds == -14_400
    assert row.end_offset_seconds == -18_000
    assert row.start_utc == "2026-11-01T04:30:00Z"
    assert row.end_utc == "2026-11-01T11:30:00Z"
