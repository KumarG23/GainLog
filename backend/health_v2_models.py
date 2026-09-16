"""Additive shadow tables for GainLog V2 health data.

These models deliberately do not replace or feed the existing daily-health pipeline.
All provider payloads are normalized into typed, provenance-bearing records.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import Index, Text
from sqlmodel import Field, SQLModel


class HealthSourceDB(SQLModel, table=True):
    __tablename__ = "health_v2_source"
    __table_args__ = (
        Index("ix_health_v2_source_provider_identity", "provider", "provider_source_identity"),
    )

    id: str = Field(primary_key=True)
    provider: str = Field(index=True)
    source_family: str = Field(index=True)
    platform: Optional[str] = Field(default=None, index=True)
    application_id: Optional[str] = None
    device_name: Optional[str] = None
    device_type: Optional[str] = None
    device_manufacturer: Optional[str] = None
    recording_method: Optional[str] = None
    provider_source_identity: str
    first_seen_at: str
    last_seen_at: str


class HealthImportRunDB(SQLModel, table=True):
    __tablename__ = "health_v2_import_run"
    __table_args__ = (
        Index("ix_health_v2_import_run_window", "requested_start", "requested_end"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    mode: str = "shadow"
    requested_start: str = Field(index=True)
    requested_end: str = Field(index=True)
    started_at: str
    finished_at: Optional[str] = None
    status: str = Field(index=True)
    complete: bool = False
    current_data_type: Optional[str] = None
    current_page: int = 0
    last_page_token_hash: Optional[str] = None
    api_version: str = "v4"
    discovery_revision: Optional[str] = None
    source_families_json: str = Field(default="[]", sa_type=Text)
    pages_processed: int = 0
    api_calls: int = 0
    records_seen: int = 0
    records_inserted: int = 0
    records_updated: int = 0
    records_unchanged: int = 0
    max_page_records: int = 0
    peak_memory_kb: Optional[int] = None
    duration_seconds: Optional[float] = None
    db_bytes_before: Optional[int] = None
    db_bytes_after: Optional[int] = None
    counts_json: str = Field(default="{}", sa_type=Text)
    pages_json: str = Field(default="{}", sa_type=Text)
    error_summary: Optional[str] = None


class HealthSampleObservationDB(SQLModel, table=True):
    __tablename__ = "health_v2_sample"
    __table_args__ = (
        Index("ix_health_v2_sample_type_time", "data_type", "observed_at_utc"),
        Index("ix_health_v2_sample_local_date_type", "local_date", "data_type"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    provider_point_id: Optional[str] = None
    provenance: str = Field(index=True)
    data_type: str = Field(index=True)
    observed_at_utc: str = Field(index=True)
    utc_offset_seconds: Optional[int] = None
    local_date: Optional[str] = Field(default=None, index=True)
    numeric_value: float
    unit: str
    category: Optional[str] = None
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    quality_status: Optional[str] = None
    is_deleted: bool = False
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthMinuteSummaryDB(SQLModel, table=True):
    __tablename__ = "health_v2_minute_summary"
    __table_args__ = (
        Index("ix_health_v2_minute_metric_time", "metric", "minute_utc"),
    )

    id: str = Field(primary_key=True)
    metric: str = Field(index=True)
    minute_utc: str = Field(index=True)
    local_date: Optional[str] = Field(default=None, index=True)
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    provenance: str = Field(index=True)
    unit: str
    sample_count: int
    minimum: float
    maximum: float
    average: float
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    updated_at: str


class HealthIntervalObservationDB(SQLModel, table=True):
    __tablename__ = "health_v2_interval"
    __table_args__ = (
        Index("ix_health_v2_interval_type_start", "data_type", "start_utc"),
        Index("ix_health_v2_interval_local_date_type", "local_date", "data_type"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    provider_point_id: Optional[str] = None
    provenance: str = Field(index=True)
    data_type: str = Field(index=True)
    start_utc: str = Field(index=True)
    end_utc: str = Field(index=True)
    start_offset_seconds: Optional[int] = None
    end_offset_seconds: Optional[int] = None
    local_date: Optional[str] = Field(default=None, index=True)
    numeric_value: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    quality_status: Optional[str] = None
    is_deleted: bool = False
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthSleepSessionDB(SQLModel, table=True):
    __tablename__ = "health_v2_sleep_session"
    __table_args__ = (
        Index("ix_health_v2_sleep_start", "start_utc"),
        Index("ix_health_v2_sleep_local_date", "local_end_date"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    provider_point_id: Optional[str] = None
    provenance: str = Field(index=True)
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    start_utc: str = Field(index=True)
    end_utc: str = Field(index=True)
    start_offset_seconds: Optional[int] = None
    end_offset_seconds: Optional[int] = None
    local_start_date: Optional[str] = Field(default=None, index=True)
    local_end_date: Optional[str] = Field(default=None, index=True)
    session_kind: str = Field(index=True)
    provider_sleep_type: Optional[str] = None
    is_main_sleep: Optional[bool] = None
    is_nap: Optional[bool] = None
    processed: Optional[bool] = None
    stages_status: Optional[str] = None
    manually_edited: Optional[bool] = None
    minutes_asleep: Optional[int] = None
    minutes_awake: Optional[int] = None
    minutes_in_sleep_period: Optional[int] = None
    minutes_to_fall_asleep: Optional[int] = None
    minutes_after_wake_up: Optional[int] = None
    stage_summary_json: str = Field(default="[]", sa_type=Text)
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    is_deleted: bool = False
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthSleepStageDB(SQLModel, table=True):
    __tablename__ = "health_v2_sleep_stage"
    __table_args__ = (
        Index("ix_health_v2_sleep_stage_session_start", "session_id", "start_utc"),
    )

    id: str = Field(primary_key=True)
    session_id: str = Field(foreign_key="health_v2_sleep_session.id", index=True)
    stage_type: str = Field(index=True)
    start_utc: str
    end_utc: str
    start_offset_seconds: Optional[int] = None
    end_offset_seconds: Optional[int] = None
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthSleepEventDB(SQLModel, table=True):
    __tablename__ = "health_v2_sleep_event"
    __table_args__ = (
        Index("ix_health_v2_sleep_event_session_start", "session_id", "start_utc"),
    )

    id: str = Field(primary_key=True)
    session_id: str = Field(foreign_key="health_v2_sleep_session.id", index=True)
    event_type: str = Field(index=True)
    start_utc: str
    end_utc: str
    start_offset_seconds: Optional[int] = None
    end_offset_seconds: Optional[int] = None
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthExerciseSessionDB(SQLModel, table=True):
    __tablename__ = "health_v2_exercise_session"
    __table_args__ = (
        Index("ix_health_v2_exercise_start", "start_utc"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    provider_point_id: Optional[str] = None
    provenance: str = Field(index=True)
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    start_utc: str = Field(index=True)
    end_utc: str = Field(index=True)
    start_offset_seconds: Optional[int] = None
    end_offset_seconds: Optional[int] = None
    local_start_date: Optional[str] = Field(default=None, index=True)
    local_end_date: Optional[str] = Field(default=None, index=True)
    exercise_type: Optional[str] = Field(default=None, index=True)
    display_name: Optional[str] = None
    active_duration_seconds: Optional[float] = None
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    is_deleted: bool = False
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthDailyMetricDB(SQLModel, table=True):
    __tablename__ = "health_v2_daily_metric"
    __table_args__ = (
        Index("ix_health_v2_daily_metric_metric_date", "metric", "date"),
    )

    id: str = Field(primary_key=True)
    provider: str = "google-health"
    date: str = Field(index=True)
    metric: str = Field(index=True)
    provenance: str = Field(index=True)
    category: Optional[str] = None
    numeric_value: Optional[float] = None
    secondary_value: Optional[float] = None
    unit: Optional[str] = None
    source_id: Optional[str] = Field(default=None, foreign_key="health_v2_source.id", index=True)
    provider_point_id: Optional[str] = None
    provider_create_time: Optional[str] = None
    provider_update_time: Optional[str] = None
    completeness: Optional[str] = None
    is_deleted: bool = False
    metadata_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    ingested_at: str


class HealthDataQualityDB(SQLModel, table=True):
    __tablename__ = "health_v2_data_quality"
    __table_args__ = (
        Index("ix_health_v2_quality_date_metric", "date", "metric"),
    )

    id: str = Field(primary_key=True)
    date: str = Field(index=True)
    metric: str = Field(index=True)
    status: str = Field(index=True)
    observed_count: Optional[int] = None
    expected_count: Optional[int] = None
    coverage_ratio: Optional[float] = None
    source_count: Optional[int] = None
    is_partial_day: bool = False
    has_source_conflict: bool = False
    details_json: str = Field(default="{}", sa_type=Text)
    payload_hash: str
    import_run_id: str = Field(foreign_key="health_v2_import_run.id", index=True)
    updated_at: str


V2_HEALTH_MODELS = (
    HealthSourceDB,
    HealthImportRunDB,
    HealthSampleObservationDB,
    HealthMinuteSummaryDB,
    HealthIntervalObservationDB,
    HealthSleepSessionDB,
    HealthSleepStageDB,
    HealthSleepEventDB,
    HealthExerciseSessionDB,
    HealthDailyMetricDB,
    HealthDataQualityDB,
)
