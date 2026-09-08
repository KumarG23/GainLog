from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyRequest(Closed):
    pass


class PageRequest(Closed):
    start_date: str | None = None
    end_date: str | None = None
    limit: StrictInt = Field(default=20, ge=1, le=50)
    offset: StrictInt = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_range(self):
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("start_date and end_date must be supplied together")
        if self.start_date is not None and self.end_date is not None:
            start = parse_date(self.start_date)
            end = parse_date(self.end_date)
            if end < start or (end - start).days > 366:
                raise ValueError("date range must be at most 366 days")
        return self


class ListWorkoutsRequest(PageRequest):
    pass


class GetWorkoutRequest(Closed):
    session_id: str | None = Field(default=None, min_length=1, max_length=128)


class NutritionRequest(PageRequest):
    entry_id: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_selector(self):
        if self.entry_id is not None and self.start_date is not None:
            raise ValueError("entry_id cannot be combined with a range")
        return self


class BodyCompositionRequest(PageRequest):
    entry_id: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_selector(self):
        if self.entry_id is not None and self.start_date is not None:
            raise ValueError("entry_id cannot be combined with a range")
        return self


class DailyHealthRequest(PageRequest):
    date: str | None = None
    dataset: Literal["canonical", "google_snapshot"] = "canonical"

    @model_validator(mode="after")
    def validate_selector(self):
        if self.date is not None:
            parse_date(self.date)
            if self.start_date is not None:
                raise ValueError("date cannot be combined with a range")
        return self


class GoalsRequest(Closed):
    goal_id: str | None = Field(default=None, min_length=1, max_length=128)
    status: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    limit: StrictInt = Field(default=20, ge=1, le=50)
    offset: StrictInt = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_selector(self):
        if self.goal_id is not None and self.status is not None:
            raise ValueError("goal_id cannot be combined with status")
        return self


class ReviewsRequest(PageRequest):
    kind: Literal["daily", "weekly", "trend"] = "daily"
    key: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_selector(self):
        if self.key is not None and self.start_date is not None:
            raise ValueError("key cannot be combined with a range")
        return self


def parse_date(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("dates must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ValueError("dates must use YYYY-MM-DD")
    return parsed


class StoreFields(Closed):
    exported_at: str
    source_db_modified_at: str
    stale: bool


class DomainCoverage(Closed):
    records: int = Field(ge=0)
    earliest_date: str | None = None
    latest_date: str | None = None


class CoverageDomains(Closed):
    workouts: DomainCoverage
    exercises: DomainCoverage
    sets: DomainCoverage
    nutrition: DomainCoverage
    body_composition: DomainCoverage
    daily_health: DomainCoverage
    google_daily_snapshots: DomainCoverage
    goals: DomainCoverage
    daily_reviews: DomainCoverage
    weekly_reviews: DomainCoverage
    trend_summaries: DomainCoverage


class SourceConnection(Closed):
    provider: Literal["google-health"]
    status: str
    connected: bool
    last_success_at: str | None
    last_attempt_at: str | None
    last_sync_count: int = Field(ge=0)
    last_sync_start: str | None
    last_sync_end: str | None


class Omissions(Closed):
    credentials: Literal["not_exported"]
    oauth_state: Literal["not_exported"]
    raw_provider_payloads: Literal["not_exported"]
    nutrition_sync_events: Literal["not_exported"]
    regeneration_and_sync: Literal["unsupported"]
    writes: Literal["unsupported"]
    arbitrary_sql_paths_urls: Literal["unsupported"]


class CoverageResult(StoreFields):
    schema_version: Literal[1]
    domains: CoverageDomains
    source_connections: list[SourceConnection]
    health_connect_owned_days: int = Field(ge=0)
    source_semantics: str
    omissions: Omissions


class PageFields(StoreFields):
    total: int = Field(ge=0)
    returned: int = Field(ge=0, le=50)
    offset: int = Field(ge=0, le=10000)
    next_offset: int | None = Field(default=None, ge=0, le=10000)


class WorkoutSummary(Closed):
    id: str
    date: str
    duration_minutes: int
    avg_heart_rate: int | None
    active_calories: int | None
    total_calories: int | None
    strength_duration_minutes: int | None
    strength_avg_heart_rate: int | None
    strength_active_calories: int | None
    strength_total_calories: int | None
    cardio_duration_minutes: int | None
    cardio_avg_heart_rate: int | None
    cardio_active_calories: int | None
    cardio_total_calories: int | None
    notes: str | None
    insight: str | None
    coach_insight_json: str | None
    template_id: str | None
    effort: str | None
    pain: bool
    exercise_count: int = Field(ge=0)
    set_count: int = Field(ge=0)


class WorkoutListResult(PageFields):
    items: list[WorkoutSummary] = Field(max_length=50)


class WorkoutSet(Closed):
    id: str
    reps: int
    weight: float


class Exercise(Closed):
    id: str
    name: str
    kind: str
    cardio_duration_minutes: int | None
    distance_miles: float | None
    resistance_level: float | None
    sets: list[WorkoutSet]


class WorkoutDetail(Closed):
    id: str
    date: str
    duration_minutes: int
    avg_heart_rate: int | None
    active_calories: int | None
    total_calories: int | None
    strength_duration_minutes: int | None
    strength_avg_heart_rate: int | None
    strength_active_calories: int | None
    strength_total_calories: int | None
    cardio_duration_minutes: int | None
    cardio_avg_heart_rate: int | None
    cardio_active_calories: int | None
    cardio_total_calories: int | None
    notes: str | None
    insight: str | None
    coach_insight_json: str | None
    template_id: str | None
    effort: str | None
    pain: bool
    exercises: list[Exercise]


class WorkoutDetailResult(StoreFields):
    workout: WorkoutDetail


class NutritionEntry(Closed):
    id: str
    date: str
    meal: str
    name: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    notes: str | None


class NutritionResult(PageFields):
    items: list[NutritionEntry] = Field(max_length=50)


class BodyCompositionEntry(Closed):
    id: str
    date: str
    weight_lbs: float
    body_fat_percent: float | None
    lean_body_mass_lbs: float | None
    bmi: float | None
    source: str | None
    source_record_id: str | None
    notes: str | None


class BodyCompositionResult(PageFields):
    items: list[BodyCompositionEntry] = Field(max_length=50)


class DailyHealthEntry(Closed):
    dataset: Literal["canonical", "google_snapshot"]
    date: str
    sleep_minutes: int | None
    deep_sleep_minutes: int | None
    core_sleep_minutes: int | None
    rem_sleep_minutes: int | None
    awake_minutes: int | None
    resting_heart_rate_bpm: float | None
    hrv_ms: float | None
    steps: int | None
    active_calories: float | None
    total_calories: float | None
    exercise_minutes: int | None
    stand_hours: int | None
    walking_running_miles: float | None
    source: str
    updated_at: str


class DailyHealthResult(PageFields):
    items: list[DailyHealthEntry] = Field(max_length=50)
    source_note: str


class Goal(Closed):
    id: str
    kind: str
    title: str
    target_value: float | None
    minimum_value: float | None
    maximum_value: float | None
    unit: str | None
    start_date: str
    target_date: str | None
    status: str
    notes: str | None


class GoalsResult(PageFields):
    items: list[Goal] = Field(max_length=50)


class SavedReview(Closed):
    kind: Literal["daily", "weekly", "trend"]
    key: str
    date: str | None
    week_start: str | None
    week_end: str | None
    category: str | None
    metric: str | None
    range: str | None
    text: str
    model: str | None
    generated_at: str


class ReviewsResult(PageFields):
    items: list[SavedReview] = Field(max_length=50)
