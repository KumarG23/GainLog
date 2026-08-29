import json
import math
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date as date_cls, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional, cast

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import func, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select
import requests

try:
    from .google_health import (
        GOOGLE_HEALTH_CALLBACK_URL, GOOGLE_OWNED_FIELDS,
        GoogleHealthConfigurationError, GoogleHealthDataError, build_authorization_url,
        require_google_health_config, sync_google_health as run_google_health_sync,
    )
except ImportError:
    from google_health import (
        GOOGLE_HEALTH_CALLBACK_URL, GOOGLE_OWNED_FIELDS,
        GoogleHealthConfigurationError, GoogleHealthDataError, build_authorization_url,
        require_google_health_config, sync_google_health as run_google_health_sync,
    )

try:
    from .coach import get_coach_provider
except ImportError:
    from coach import get_coach_provider

load_dotenv()

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get(
    "GAINLOG_DATABASE_URL",
    f"sqlite:///{DATA_DIR}/gainlog.db",
)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


# ── DB Models ──────────────────────────────────────────────────────────────────

class WorkoutSetDB(SQLModel, table=True):
    __tablename__ = "workout_set"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    reps: int
    weight: float
    exercise_id: str = Field(foreign_key="exercise.id")
    exercise: Optional["ExerciseDB"] = Relationship(back_populates="sets")


class ExerciseDB(SQLModel, table=True):
    __tablename__ = "exercise"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    kind: str = "strength"
    cardio_duration_minutes: Optional[int] = None
    distance_miles: Optional[float] = None
    resistance_level: Optional[float] = None
    session_id: str = Field(foreign_key="workout_session.id")
    sets: List[WorkoutSetDB] = Relationship(back_populates="exercise")
    session: Optional["WorkoutSessionDB"] = Relationship(back_populates="exercises")


class WorkoutSessionDB(SQLModel, table=True):
    __tablename__ = "workout_session"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    date: str  # ISO 8601
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    total_calories: Optional[int] = None
    strength_duration_minutes: Optional[int] = None
    strength_avg_heart_rate: Optional[int] = None
    strength_active_calories: Optional[int] = None
    strength_total_calories: Optional[int] = None
    cardio_duration_minutes: Optional[int] = None
    cardio_avg_heart_rate: Optional[int] = None
    cardio_active_calories: Optional[int] = None
    cardio_total_calories: Optional[int] = None
    notes: Optional[str] = None
    insight: Optional[str] = None
    insight_json: Optional[str] = None
    template_id: Optional[str] = None
    effort: Optional[str] = None
    pain: bool = False
    exercises: List[ExerciseDB] = Relationship(back_populates="session")


class BodyWeightEntryDB(SQLModel, table=True):
    __tablename__ = "body_weight_entry"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    date: str
    weight_lbs: float
    body_fat_percent: Optional[float] = None
    lean_body_mass_lbs: Optional[float] = None
    bmi: Optional[float] = None
    source: Optional[str] = None
    source_record_id: Optional[str] = None
    notes: Optional[str] = None


class AppleHealthDailyDB(SQLModel, table=True):
    __tablename__ = "apple_health_daily"
    date: str = Field(primary_key=True)
    sleep_minutes: Optional[int] = None
    deep_sleep_minutes: Optional[int] = None
    core_sleep_minutes: Optional[int] = None
    rem_sleep_minutes: Optional[int] = None
    awake_minutes: Optional[int] = None
    resting_heart_rate_bpm: Optional[float] = None
    hrv_ms: Optional[float] = None
    steps: Optional[int] = None
    active_calories: Optional[float] = None
    total_calories: Optional[float] = None
    exercise_minutes: Optional[int] = None
    stand_hours: Optional[int] = None
    walking_running_miles: Optional[float] = None
    source: str = "apple-health"
    updated_at: str


class HealthConnectDailyOwnershipDB(SQLModel, table=True):
    __tablename__ = "health_connect_daily_ownership"
    date: str = Field(primary_key=True)


class GoalDB(SQLModel, table=True):
    __tablename__ = "goal"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    kind: str
    title: str
    target_value: Optional[float] = None
    minimum_value: Optional[float] = None
    maximum_value: Optional[float] = None
    unit: Optional[str] = None
    start_date: str
    target_date: Optional[str] = None
    status: str = "active"
    notes: Optional[str] = None


class NutritionEntryDB(SQLModel, table=True):
    __tablename__ = "nutrition_entry"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    date: str
    meal: str
    name: str
    calories: int
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    notes: Optional[str] = None


class NutritionSyncEventDB(SQLModel, table=True):
    __tablename__ = "nutrition_sync_event"
    cursor: Optional[int] = Field(default=None, primary_key=True)
    operation: str
    entry_id: str
    payload_json: Optional[str] = None


class DailyReviewDB(SQLModel, table=True):
    __tablename__ = "daily_review"
    date: str = Field(primary_key=True)
    review: str
    generated_at: str


class WeeklyReviewDB(SQLModel, table=True):
    __tablename__ = "weekly_review"
    week_end: str = Field(primary_key=True)
    week_start: str
    review: str
    generated_at: str


class GoogleHealthOAuthStateDB(SQLModel, table=True):
    __tablename__ = "google_health_oauth_state"
    state: str = Field(primary_key=True)
    code_verifier: str
    expires_at: str
    consumed_at: Optional[str] = None


class GoogleHealthConnectionDB(SQLModel, table=True):
    __tablename__ = "google_health_connection"
    id: str = Field(default="primary", primary_key=True)
    encrypted_refresh_token: Optional[str] = None
    status: str = "disconnected"
    last_success_at: Optional[str] = None
    last_attempt_at: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_count: int = 0
    last_sync_start: Optional[str] = None
    last_sync_end: Optional[str] = None


class GoogleHealthDailySnapshotDB(SQLModel, table=True):
    __tablename__ = "google_health_daily_snapshot"
    date: str = Field(primary_key=True)
    sleep_minutes: Optional[int] = None
    deep_sleep_minutes: Optional[int] = None
    core_sleep_minutes: Optional[int] = None
    rem_sleep_minutes: Optional[int] = None
    awake_minutes: Optional[int] = None
    resting_heart_rate_bpm: Optional[float] = None
    hrv_ms: Optional[float] = None
    steps: Optional[int] = None
    active_calories: Optional[float] = None
    total_calories: Optional[float] = None
    exercise_minutes: Optional[int] = None
    walking_running_miles: Optional[float] = None
    source_updated_at: str


def get_db():
    with Session(engine) as session:
        yield session


# ── Pydantic Schemas ───────────────────────────────────────────────────────────

class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class WorkoutSetOut(CamelModel):
    id: str
    reps: int
    weight: float


class WorkoutSetIn(CamelModel):
    id: Optional[str] = None
    reps: int
    weight: float


class ExerciseOut(CamelModel):
    id: str
    name: str
    kind: Literal["strength", "cardio"] = "strength"
    sets: List[WorkoutSetOut]
    cardio_duration_minutes: Optional[int] = None
    distance_miles: Optional[float] = None
    resistance_level: Optional[float] = None


class ExerciseIn(CamelModel):
    id: Optional[str] = None
    name: str
    kind: Literal["strength", "cardio"] = "strength"
    sets: List[WorkoutSetIn] = Field(default_factory=list)
    cardio_duration_minutes: Optional[int] = None
    distance_miles: Optional[float] = None
    resistance_level: Optional[float] = None


class ActivitySummary(CamelModel):
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    total_calories: Optional[int] = None


class CoachNextAction(CamelModel):
    title: str = Field(min_length=1, max_length=40)
    detail: str = Field(min_length=1, max_length=240)


class CoachInsight(CamelModel):
    headline: str = Field(min_length=1, max_length=80)
    verdict: str = Field(min_length=1, max_length=320)
    wins: List[str] = Field(default_factory=list, max_length=2)
    caveat: Optional[str] = Field(default=None, max_length=240)
    next_action: CoachNextAction
    question: str = Field(default="How did this feel?", min_length=1, max_length=80)
    confidence: Literal["low", "medium", "high"] = "medium"

    @field_validator("wins")
    @classmethod
    def validate_wins(cls, values: List[str]) -> List[str]:
        if any(not value.strip() or len(value) > 180 for value in values):
            raise ValueError("wins must be non-empty and at most 180 characters each")
        return values


class WorkoutSessionOut(CamelModel):
    id: str
    date: str
    exercises: List[ExerciseOut]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    total_calories: Optional[int] = None
    strength_summary: Optional[ActivitySummary] = None
    cardio_summary: Optional[ActivitySummary] = None
    notes: Optional[str] = None
    insight: Optional[str] = None
    coach_insight: Optional[CoachInsight] = None
    template_id: Optional[Literal["push", "pull", "recovery", "legs", "upper"]] = None
    effort: Optional[Literal["easy", "right", "hard"]] = None
    pain: bool = False


class WorkoutSessionIn(CamelModel):
    id: Optional[str] = None
    date: str
    exercises: List[ExerciseIn]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    total_calories: Optional[int] = None
    strength_summary: Optional[ActivitySummary] = None
    cardio_summary: Optional[ActivitySummary] = None
    notes: Optional[str] = None
    template_id: Optional[Literal["push", "pull", "recovery", "legs", "upper"]] = None
    effort: Optional[Literal["easy", "right", "hard"]] = None
    pain: bool = False


class WorkoutFeedbackIn(CamelModel):
    effort: Optional[Literal["easy", "right", "hard"]] = None
    pain: Optional[bool] = None


class BodyWeightEntryOut(CamelModel):
    id: str
    date: str
    weight_lbs: float
    body_fat_percent: Optional[float] = None
    lean_body_mass_lbs: Optional[float] = None
    bmi: Optional[float] = None
    source: Optional[str] = None
    source_record_id: Optional[str] = None
    notes: Optional[str] = None


class BodyWeightEntryIn(CamelModel):
    id: Optional[str] = None
    date: str
    weight_lbs: float = Field(gt=0, le=1500)
    body_fat_percent: Optional[float] = Field(default=None, ge=0, le=100)
    lean_body_mass_lbs: Optional[float] = Field(default=None, gt=0, le=1500)
    bmi: Optional[float] = Field(default=None, ge=5, le=100)
    source: Optional[Literal["apple-health", "health-connect", "renpho-csv", "manual"]] = None
    source_record_id: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None
    replace_existing: bool = False


class HealthConnectBodyWeightReconcileIn(CamelModel):
    start_time: str
    end_time: str
    source_record_ids: list[str] = Field(default_factory=list, max_length=5000)
    observed_record_count: Optional[int] = Field(default=None, ge=0, le=5000)


class AppleHealthDailyOut(CamelModel):
    date: str
    sleep_minutes: Optional[int] = None
    deep_sleep_minutes: Optional[int] = None
    core_sleep_minutes: Optional[int] = None
    rem_sleep_minutes: Optional[int] = None
    awake_minutes: Optional[int] = None
    resting_heart_rate_bpm: Optional[float] = None
    hrv_ms: Optional[float] = None
    steps: Optional[int] = None
    active_calories: Optional[float] = None
    total_calories: Optional[float] = None
    exercise_minutes: Optional[int] = None
    stand_hours: Optional[int] = None
    walking_running_miles: Optional[float] = None
    source: Literal["apple-health", "health-connect", "google-health"] = "apple-health"
    updated_at: str


class AppleHealthDailyIn(CamelModel):
    date: str
    sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    deep_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    core_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    rem_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    awake_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    resting_heart_rate_bpm: Optional[float] = Field(default=None, ge=20, le=250)
    hrv_ms: Optional[float] = Field(default=None, ge=0, le=1000)
    steps: Optional[int] = Field(default=None, ge=0, le=200000)
    active_calories: Optional[float] = Field(default=None, ge=0, le=20000)
    total_calories: Optional[float] = Field(default=None, ge=0, le=20000)
    exercise_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    stand_hours: Optional[int] = Field(default=None, ge=0, le=24)
    walking_running_miles: Optional[float] = Field(default=None, ge=0, le=200)
    source: Literal["apple-health"] = "apple-health"

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        try:
            parsed = date_cls.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("date must use YYYY-MM-DD") from exc
        if parsed.isoformat() != value:
            raise ValueError("date must use YYYY-MM-DD")
        return value


class HealthConnectDailyIn(CamelModel):
    date: str
    sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    deep_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    light_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    rem_sleep_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    awake_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    resting_heart_rate_bpm: Optional[float] = Field(default=None, ge=20, le=250)
    hrv_ms: Optional[float] = Field(default=None, ge=0, le=1000)
    steps: Optional[int] = Field(default=None, ge=0, le=200000)
    distance_miles: Optional[float] = Field(default=None, ge=0, le=200)
    active_calories: Optional[float] = Field(default=None, ge=0, le=20000)
    total_calories: Optional[float] = Field(default=None, ge=0, le=20000)
    exercise_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    replace_existing: bool = False
    source: Literal["health-connect"] = "health-connect"

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        return AppleHealthDailyIn.validate_date(value)


class HealthAutoExportImportOut(CamelModel):
    daily_summaries: int
    body_measurements: int
    ignored_metrics: list[str]


class GoalOut(CamelModel):
    id: str
    kind: str
    title: str
    target_value: Optional[float] = None
    minimum_value: Optional[float] = None
    maximum_value: Optional[float] = None
    unit: Optional[str] = None
    start_date: str
    target_date: Optional[str] = None
    status: str
    notes: Optional[str] = None


class GoalIn(CamelModel):
    id: Optional[str] = None
    kind: str
    title: str
    target_value: Optional[float] = None
    minimum_value: Optional[float] = None
    maximum_value: Optional[float] = None
    unit: Optional[str] = None
    start_date: str
    target_date: Optional[str] = None
    status: str = "active"
    notes: Optional[str] = None


class GoalPatch(CamelModel):
    title: Optional[str] = None
    target_value: Optional[float] = None
    minimum_value: Optional[float] = None
    maximum_value: Optional[float] = None
    unit: Optional[str] = None
    target_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class NutritionEntryOut(CamelModel):
    id: str
    date: str
    meal: str
    name: str
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float
    notes: Optional[str] = None


class NutritionEntryIn(CamelModel):
    id: Optional[str] = None
    date: str
    meal: str
    name: str
    calories: int
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    notes: Optional[str] = None


class NutritionEntryPatch(CamelModel):
    date: Optional[str] = None
    meal: Optional[str] = None
    name: Optional[str] = None
    calories: Optional[int] = None
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    fiber_g: Optional[float] = None
    notes: Optional[str] = None


class NutritionSyncEventOut(CamelModel):
    cursor: int
    operation: Literal["upsert", "delete"]
    entry_id: str
    entry: Optional[NutritionEntryOut] = None


class NutritionSyncFeedOut(CamelModel):
    events: List[NutritionSyncEventOut]
    next_cursor: int
    latest_cursor: int
    has_more: bool


class NutritionSyncBootstrapOut(CamelModel):
    entries: List[NutritionEntryOut]
    latest_cursor: int


class NutritionTotals(CamelModel):
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float


class DashboardSummaryOut(CamelModel):
    latest_weight: Optional[BodyWeightEntryOut]
    today_health: Optional[AppleHealthDailyOut]
    active_goals: List[GoalOut]
    today_nutrition: NutritionTotals
    workout_count: int
    total_workout_volume: int
    latest_workout: Optional[WorkoutSessionOut]


class CoachStatusOut(CamelModel):
    provider: str
    model: Optional[str] = None
    base_url: Optional[str] = None
    configured: bool


class InsightResponse(CamelModel):
    insight: str
    coach_insight: CoachInsight


class GoogleHealthStatusOut(CamelModel):
    connected: bool
    configured: bool
    last_success_at: Optional[str] = None
    last_attempt_at: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_count: int = 0
    last_sync_start: Optional[str] = None
    last_sync_end: Optional[str] = None


class GoogleHealthSyncIn(CamelModel):
    # Routine reconciliation remains bounded; historical import is explicit.
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    backfill: bool = False


class GoogleHealthSyncOut(CamelModel):
    synced_days: int
    start_date: str
    end_date: str


class DailyReviewOut(CamelModel):
    date: str
    review: str
    generated_at: str


class WeeklyReviewOut(CamelModel):
    week_start: str
    week_end: str
    review: str
    generated_at: str


# ── App ────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
    # Add fields to existing SQLite databases that predate them.
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE workout_session ADD COLUMN insight TEXT",
            "ALTER TABLE exercise ADD COLUMN kind TEXT DEFAULT 'strength'",
            "ALTER TABLE exercise ADD COLUMN cardio_duration_minutes INTEGER",
            "ALTER TABLE exercise ADD COLUMN distance_miles REAL",
            "ALTER TABLE exercise ADD COLUMN resistance_level REAL",
            "ALTER TABLE workout_session ADD COLUMN strength_duration_minutes INTEGER",
            "ALTER TABLE workout_session ADD COLUMN strength_avg_heart_rate INTEGER",
            "ALTER TABLE workout_session ADD COLUMN strength_active_calories INTEGER",
            "ALTER TABLE workout_session ADD COLUMN total_calories INTEGER",
            "ALTER TABLE workout_session ADD COLUMN strength_total_calories INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_duration_minutes INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_avg_heart_rate INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_active_calories INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_total_calories INTEGER",
            "ALTER TABLE workout_session ADD COLUMN insight_json TEXT",
            "ALTER TABLE workout_session ADD COLUMN template_id TEXT",
            "ALTER TABLE workout_session ADD COLUMN effort TEXT",
            "ALTER TABLE workout_session ADD COLUMN pain BOOLEAN DEFAULT 0",
            "ALTER TABLE nutrition_entry ADD COLUMN fiber_g REAL DEFAULT 0",
            "ALTER TABLE body_weight_entry ADD COLUMN body_fat_percent REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN lean_body_mass_lbs REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN bmi REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN source TEXT",
            "ALTER TABLE body_weight_entry ADD COLUMN source_record_id TEXT",
            "ALTER TABLE goal ADD COLUMN minimum_value REAL",
            "ALTER TABLE goal ADD COLUMN maximum_value REAL",
            "ALTER TABLE apple_health_daily ADD COLUMN total_calories REAL",
        ]
        for statement in migrations:
            try:
                conn.execute(text(statement))
                conn.commit()
            except Exception:
                pass  # Column already exists
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_body_weight_source_record "
                "ON body_weight_entry (source, source_record_id)"
            )
        )
        conn.execute(
            text(
                "INSERT OR IGNORE INTO health_connect_daily_ownership (date) "
                "SELECT date FROM apple_health_daily WHERE source = 'health-connect'"
            )
        )
        conn.commit()
    yield


app = FastAPI(title="GainLog API", lifespan=lifespan)

DEFAULT_CORS_ORIGINS = (
    "https://gainlog-frontend.tailc88c35.ts.net,"
    "http://100.97.25.76:8081"
)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("GAINLOG_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_native_health_import(request: Request) -> None:
    if request.headers.get("origin"):
        raise HTTPException(
            status_code=403,
            detail="Apple Health imports are accepted only from native clients",
        )


def _decode_coach_insight(raw: str) -> Optional[CoachInsight]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```")
        cleaned = cleaned.removesuffix("```").strip()
    try:
        return CoachInsight.model_validate(json.loads(cleaned))
    except (json.JSONDecodeError, ValidationError):
        return None


def _parse_coach_insight(raw: str) -> CoachInsight:
    parsed = _decode_coach_insight(raw)
    if parsed:
        return parsed
    return CoachInsight(
        headline="Workout complete",
        verdict="The coach response could not be structured. Your workout is still saved.",
        next_action=CoachNextAction(
            title="Next move",
            detail="Follow your scheduled plan and adjust only if recovery calls for it.",
        ),
        confidence="low",
    )


def _legacy_insight_text(raw: str, insight: CoachInsight) -> str:
    if _decode_coach_insight(raw) is None:
        return raw.strip()
    parts = [insight.headline, insight.verdict, *insight.wins]
    if insight.caveat:
        parts.append(insight.caveat)
    parts.append(f"{insight.next_action.title}: {insight.next_action.detail}")
    return " ".join(parts)


def _to_out(s: WorkoutSessionDB) -> WorkoutSessionOut:
    strength_summary = (
        ActivitySummary(
            duration_minutes=s.strength_duration_minutes,
            avg_heart_rate=s.strength_avg_heart_rate,
            active_calories=s.strength_active_calories,
            total_calories=s.strength_total_calories,
        )
        if s.strength_duration_minutes is not None
        else None
    )
    cardio_summary = (
        ActivitySummary(
            duration_minutes=s.cardio_duration_minutes,
            avg_heart_rate=s.cardio_avg_heart_rate,
            active_calories=s.cardio_active_calories,
            total_calories=s.cardio_total_calories,
        )
        if s.cardio_duration_minutes is not None
        else None
    )
    coach_insight = _parse_coach_insight(s.insight_json) if s.insight_json else None
    return WorkoutSessionOut(
        id=s.id,
        date=s.date,
        duration_minutes=s.duration_minutes,
        avg_heart_rate=s.avg_heart_rate,
        active_calories=s.active_calories,
        total_calories=s.total_calories,
        strength_summary=strength_summary,
        cardio_summary=cardio_summary,
        notes=s.notes,
        insight=s.insight,
        coach_insight=coach_insight,
        template_id=cast(
            Optional[Literal["push", "pull", "recovery", "legs", "upper"]],
            s.template_id,
        ),
        effort=cast(Optional[Literal["easy", "right", "hard"]], s.effort),
        pain=bool(s.pain),
        exercises=[
            ExerciseOut(
                id=e.id,
                name=e.name,
                kind="cardio" if e.kind == "cardio" else "strength",
                cardio_duration_minutes=e.cardio_duration_minutes,
                distance_miles=e.distance_miles,
                resistance_level=e.resistance_level,
                sets=[WorkoutSetOut(id=ws.id, reps=ws.reps, weight=ws.weight) for ws in e.sets],
            )
            for e in s.exercises
        ],
    )


def _body_weight_to_out(entry: BodyWeightEntryDB) -> BodyWeightEntryOut:
    return BodyWeightEntryOut(
        id=entry.id,
        date=entry.date,
        weight_lbs=entry.weight_lbs,
        body_fat_percent=entry.body_fat_percent,
        lean_body_mass_lbs=entry.lean_body_mass_lbs,
        bmi=entry.bmi,
        source=entry.source,
        source_record_id=entry.source_record_id,
        notes=entry.notes,
    )


def _apple_health_daily_to_out(entry: AppleHealthDailyDB) -> AppleHealthDailyOut:
    return AppleHealthDailyOut.model_validate(entry, from_attributes=True)


def _health_auto_export_key(name: str) -> str:
    return "".join(character for character in name.lower() if character.isalnum())


def _health_auto_export_date(value: Any) -> Optional[str]:
    if not isinstance(value, str) or len(value) < 10:
        return None
    candidate = value[:10]
    try:
        return date_cls.fromisoformat(candidate).isoformat()
    except ValueError:
        return None


def _health_auto_export_timestamp(value: Any, fallback_date: str) -> str:
    if isinstance(value, str):
        for format_string in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(value, format_string).isoformat()
            except ValueError:
                pass
        if len(value) >= 10 and _health_auto_export_date(value):
            return value if "T" in value else value.replace(" ", "T", 1)
    return f"{fallback_date}T12:00:00"


def _health_auto_export_minutes(value: float, units: str) -> int:
    normalized = units.lower()
    if normalized in {"h", "hr", "hrs", "hour", "hours"}:
        value *= 60
    elif normalized in {"s", "sec", "secs", "second", "seconds"}:
        value /= 60
    return int(round(value))


def _health_auto_export_pounds(value: float, units: str) -> float:
    if units.lower() in {"kg", "kilogram", "kilograms"}:
        value *= 2.2046226218
    return round(value, 3)


def _health_auto_export_kcal(value: float, units: str) -> float:
    if units.lower() in {"kj", "kilojoule", "kilojoules"}:
        value /= 4.184
    return round(value, 2)


def _health_auto_export_miles(value: float, units: str) -> float:
    normalized = units.lower()
    if normalized in {"km", "kilometer", "kilometers"}:
        value *= 0.6213711922
    elif normalized in {"m", "meter", "meters"}:
        value *= 0.0006213711922
    return round(value, 2)


def _goal_to_out(goal: GoalDB) -> GoalOut:
    return GoalOut(
        id=goal.id,
        kind=goal.kind,
        title=goal.title,
        target_value=goal.target_value,
        minimum_value=goal.minimum_value,
        maximum_value=goal.maximum_value,
        unit=goal.unit,
        start_date=goal.start_date,
        target_date=goal.target_date,
        status=goal.status,
        notes=goal.notes,
    )


def _format_goal_for_coach(goal: GoalDB) -> str:
    unit = f" {goal.unit}" if goal.unit else ""
    if goal.minimum_value is not None and goal.maximum_value is not None:
        target = f"{goal.minimum_value:g}–{goal.maximum_value:g}{unit}"
        if goal.target_value is not None:
            target += f" (aim {goal.target_value:g}{unit})"
        return f"{goal.title}: {target}"
    if goal.target_value is not None:
        return f"{goal.title}: {goal.target_value:g}{unit}"
    if goal.minimum_value is not None:
        return f"{goal.title}: at least {goal.minimum_value:g}{unit}"
    if goal.maximum_value is not None:
        return f"{goal.title}: up to {goal.maximum_value:g}{unit}"
    return goal.title


def _nutrition_to_out(entry: NutritionEntryDB) -> NutritionEntryOut:
    return NutritionEntryOut(
        id=entry.id,
        date=entry.date,
        meal=entry.meal,
        name=entry.name,
        calories=entry.calories,
        protein_g=entry.protein_g,
        carbs_g=entry.carbs_g,
        fat_g=entry.fat_g,
        fiber_g=entry.fiber_g,
        notes=entry.notes,
    )


def _queue_nutrition_sync_event(
    db: Session,
    operation: Literal["upsert", "delete"],
    entry_id: str,
    entry: Optional[NutritionEntryDB] = None,
) -> None:
    payload_json = None
    if entry is not None:
        payload_json = json.dumps(
            _nutrition_to_out(entry).model_dump(by_alias=True),
            separators=(",", ":"),
        )
    db.add(
        NutritionSyncEventDB(
            operation=operation,
            entry_id=entry_id,
            payload_json=payload_json,
        )
    )


GOAL_KINDS = {"weight", "calories", "protein", "fiber", "workout_frequency"}


def _validate_goal_kind(kind: str) -> None:
    if kind not in GOAL_KINDS:
        allowed = ", ".join(sorted(GOAL_KINDS))
        raise HTTPException(status_code=400, detail=f"Unsupported goal kind. Use one of: {allowed}")


def _validate_goal_values(
    minimum_value: Optional[float],
    target_value: Optional[float],
    maximum_value: Optional[float],
) -> None:
    ordered = [value for value in (minimum_value, target_value, maximum_value) if value is not None]
    if any(not math.isfinite(value) for value in ordered):
        raise HTTPException(status_code=400, detail="Goal values must be finite numbers")
    if ordered != sorted(ordered):
        raise HTTPException(
            status_code=400,
            detail="Goal values must satisfy minimum <= target <= maximum",
        )


def _get_coach_status() -> CoachStatusOut:
    provider = os.environ.get("GAINLOG_COACH_PROVIDER", "ollama").strip().lower()
    if provider == "ollama":
        return CoachStatusOut(
            provider=provider,
            model=os.environ.get("OLLAMA_MODEL", "qwen2.5:7b"),
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
            configured=bool(os.environ.get("OLLAMA_BASE_URL")),
        )
    if provider == "anthropic":
        return CoachStatusOut(
            provider=provider,
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            configured=bool(os.environ.get("ANTHROPIC_API_KEY")),
        )
    if provider == "luna":
        return CoachStatusOut(
            provider=provider,
            model=os.environ.get("GAINLOG_COACH_MODEL", "gpt-5.6-luna"),
            base_url=os.environ.get("GAINLOG_COACH_BASE_URL"),
            configured=bool(
                os.environ.get("GAINLOG_COACH_BASE_URL")
                and os.environ.get("GAINLOG_COACH_API_KEY")
            ),
        )
    return CoachStatusOut(provider=provider, configured=False)


def _nutrition_totals_for_date(db: Session, date_prefix: str) -> NutritionTotals:
    rows = db.exec(
        select(NutritionEntryDB)
        .where(NutritionEntryDB.date.startswith(date_prefix))
    ).all()
    return NutritionTotals(
        calories=sum(entry.calories for entry in rows),
        protein_g=sum(entry.protein_g for entry in rows),
        carbs_g=sum(entry.carbs_g for entry in rows),
        fat_g=sum(entry.fat_g for entry in rows),
        fiber_g=sum(entry.fiber_g for entry in rows),
    )


# ── Insight helpers ────────────────────────────────────────────────────────────

def _session_volume(s: WorkoutSessionDB) -> int:
    return int(sum(ws.weight * ws.reps for ex in s.exercises for ws in ex.sets))


def _format_session(s: WorkoutSessionDB, label: str) -> str:
    lines = [f"{label} ({s.date[:10]}, {s.duration_minutes} min):"]
    for ex in s.exercises:
        if ex.kind == "cardio":
            details = []
            if ex.cardio_duration_minutes is not None:
                details.append(f"{ex.cardio_duration_minutes} min")
            if ex.distance_miles is not None:
                details.append(f"{ex.distance_miles:g} miles")
            if ex.resistance_level is not None:
                details.append(f"resistance {ex.resistance_level:g}")
            lines.append(f"  {ex.name} (cardio): {', '.join(details) or 'completed'}")
            continue
        sets_str = "  ".join(f"{ws.weight}×{ws.reps}" for ws in ex.sets)
        vol = int(sum(ws.weight * ws.reps for ws in ex.sets))
        lines.append(f"  {ex.name}: {sets_str}  [{vol} lbs volume]")
    if s.strength_duration_minutes is not None:
        details = [f"{s.strength_duration_minutes} min"]
        if s.strength_avg_heart_rate is not None:
            details.append(f"Avg HR {s.strength_avg_heart_rate} bpm")
        if s.strength_total_calories is not None:
            details.append(f"Total calories {s.strength_total_calories} kcal")
        elif s.strength_active_calories is not None:
            details.append(f"{s.strength_active_calories} kcal")
        lines.append(f"  Strength session: {', '.join(details)}")
    if s.cardio_duration_minutes is not None:
        details = [f"{s.cardio_duration_minutes} min"]
        if s.cardio_avg_heart_rate is not None:
            details.append(f"Avg HR {s.cardio_avg_heart_rate} bpm")
        if s.cardio_total_calories is not None:
            details.append(f"Total calories {s.cardio_total_calories} kcal")
        elif s.cardio_active_calories is not None:
            details.append(f"{s.cardio_active_calories} kcal")
        lines.append(f"  Cardio session: {', '.join(details)}")
    if s.avg_heart_rate:
        lines.append(f"  Avg HR: {s.avg_heart_rate} bpm")
    if s.total_calories:
        lines.append(f"  Total calories: {s.total_calories} kcal")
    elif s.active_calories:
        lines.append(f"  Calories: {s.active_calories} kcal")
    if s.template_id:
        lines.append(f"  Workout plan: {s.template_id}")
    if s.notes:
        normalized_notes = " ".join(s.notes.split())[:500]
        if normalized_notes:
            lines.append(f"  Workout notes: {normalized_notes}")
    if s.effort:
        lines.append(f"  Reported effort: {s.effort}")
    if s.pain:
        lines.append("  Pain reported: yes")
    lines.append(f"  Session volume: {_session_volume(s)} lbs")
    return "\n".join(lines)


def _format_weight_measurement(weight: BodyWeightEntryDB, prefix: str) -> str:
    details = [f"{weight.weight_lbs:g} lbs"]
    if weight.body_fat_percent is not None:
        details.append(f"{weight.body_fat_percent:g}% body fat")
    if weight.lean_body_mass_lbs is not None:
        details.append(f"{weight.lean_body_mass_lbs:g} lbs lean body mass")
    if weight.bmi is not None:
        details.append(f"BMI {weight.bmi:g}")
    if weight.source:
        details.append(f"source {weight.source}")
    return f"{prefix}: {', '.join(details)}"


def _format_minutes(minutes: int) -> str:
    hours, remaining = divmod(minutes, 60)
    if hours and remaining:
        return f"{hours}h {remaining}m"
    if hours:
        return f"{hours}h"
    return f"{remaining}m"


def _format_apple_health_daily(summary: Optional[AppleHealthDailyDB]) -> str:
    if not summary:
        return "No Apple Health recovery or activity summary imported."

    lines = []
    if summary.sleep_minutes is not None:
        lines.append(f"Sleep: {_format_minutes(summary.sleep_minutes)}")
    sleep_stages = []
    for label, value in (
        ("Deep", summary.deep_sleep_minutes),
        ("Core", summary.core_sleep_minutes),
        ("REM", summary.rem_sleep_minutes),
        ("Awake", summary.awake_minutes),
    ):
        if value is not None:
            sleep_stages.append(f"{label} {_format_minutes(value)}")
    if sleep_stages:
        lines.append("Sleep stages: " + ", ".join(sleep_stages))
    if summary.resting_heart_rate_bpm is not None:
        lines.append(f"Resting heart rate: {summary.resting_heart_rate_bpm:g} bpm")
    if summary.hrv_ms is not None:
        lines.append(f"HRV: {summary.hrv_ms:g} ms")
    if summary.steps is not None:
        lines.append(f"Steps: {summary.steps:,}")
    if summary.active_calories is not None:
        lines.append(f"Active energy: {summary.active_calories:g} kcal")
    if summary.exercise_minutes is not None:
        lines.append(f"Exercise: {summary.exercise_minutes} min")
    if summary.stand_hours is not None:
        lines.append(f"Stand: {summary.stand_hours} hr")
    if summary.walking_running_miles is not None:
        lines.append(f"Walking/running distance: {summary.walking_running_miles:g} miles")
    return "\n".join(lines)


def _format_broader_context(
    latest_weight: Optional[BodyWeightEntryDB],
    active_weight_goal: Optional[GoalDB],
    nutrition_totals: NutritionTotals,
    nutrition_date: str,
) -> str:
    lines = []
    if latest_weight:
        lines.append(
            _format_weight_measurement(latest_weight, "Latest body measurement")
            + f" on {latest_weight.date[:10]}."
        )
    if active_weight_goal:
        goal = f"Active weight goal: {_format_goal_for_coach(active_weight_goal)}"
        if active_weight_goal.target_date:
            goal += f" by {active_weight_goal.target_date[:10]}"
        lines.append(f"{goal}.")
    if (
        nutrition_totals.calories
        or nutrition_totals.protein_g
        or nutrition_totals.carbs_g
        or nutrition_totals.fat_g
    ):
        lines.append(
            f"Nutrition on {nutrition_date}: {nutrition_totals.calories} kcal, "
            f"{nutrition_totals.protein_g:g}g protein, {nutrition_totals.carbs_g:g}g carbs, "
            f"{nutrition_totals.fat_g:g}g fat, {nutrition_totals.fiber_g:g}g fiber."
        )
    return "\n".join(lines)


def _build_prompt(
    current: WorkoutSessionDB,
    history: list[WorkoutSessionDB],
    broader_context: Optional[str] = None,
) -> str:
    current_block = _format_session(current, "CURRENT WORKOUT")

    if history:
        history_blocks = "\n\n".join(
            _format_session(s, f"PREVIOUS SESSION {i + 1}") for i, s in enumerate(history)
        )
        avg_vol = sum(_session_volume(s) for s in history) / len(history)
        context = (
            f"RECENT HISTORY ({len(history)} sessions):\n\n"
            f"{history_blocks}\n\n"
            f"Recent average session volume: {int(avg_vol)} lbs"
        )
    else:
        context = "No previous sessions on record — this is their first logged workout."

    broader_context_block = (
        f"\n\nBROADER FITNESS CONTEXT:\n{broader_context}"
        if broader_context
        else ""
    )

    next_template = {
        "push": "pull",
        "pull": "recovery",
        "recovery": "legs",
        "legs": "upper",
        "upper": "next week's push",
    }.get(current.template_id or "")
    plan_context = (
        f"WORKOUT PLAN: {current.template_id}; next scheduled template: {next_template}."
        if current.template_id
        else "WORKOUT PLAN: no template was selected; do not invent one."
    )

    return f"""You are a personal trainer AI reviewing a client's workout log.

{current_block}

{plan_context}

{context}{broader_context_block}

Create a compact coaching response with a clear verdict, no more than two evidence-backed wins, an optional comparison caveat, and one plan-aligned next action. Treat strength and cardio summaries as distinct segments. When both are recorded, discuss both within one combined response instead of merging their heart rate or calorie metrics.

Rules:
- Never criticize absent strength during planned recovery cardio.
- Never invent a workout when a recorded plan exists; connect the next action to the next scheduled template.
- Compare only genuinely comparable sessions of the same modality. Do not infer improved cardiovascular efficiency unless activity, speed/incline or resistance, and effort are sufficiently comparable; otherwise state the limitation.
- Call something a personal record only when the record type and available history support it.
- Use reported effort and pain from prior sessions when choosing the next action. Pain should make the advice conservative, not diagnostic.
- Keep each text field concise and the total visible coaching copy under about 90 words.

Return only valid JSON matching this exact shape, with no markdown fence or extra prose:
{{
  "headline": "short coaching verdict",
  "verdict": "one concise interpretation",
  "wins": ["zero to two evidence-backed wins"],
  "caveat": "comparison limitation or null",
  "nextAction": {{"title": "Next move", "detail": "one plan-aligned action"}},
  "question": "How did this feel?",
  "confidence": "low, medium, or high"
}}"""


def _build_daily_review_prompt(
    review_date: str,
    weight: Optional[BodyWeightEntryDB],
    health_summary: Optional[AppleHealthDailyDB],
    recent_weights: list[BodyWeightEntryDB],
    nutrition_entries: list[NutritionEntryDB],
    nutrition_totals: NutritionTotals,
    workouts: list[WorkoutSessionDB],
    active_goals: list[GoalDB],
) -> str:
    weight_lines = (
        [_format_weight_measurement(weight, "Today's body measurement") + "."]
        if weight
        else ["Today's weight: not logged."]
    )
    if recent_weights:
        weight_lines.append(
            "Recent weights: "
            + ", ".join(
                f"{entry.date[:10]} {entry.weight_lbs:g} lbs" for entry in recent_weights
            )
            + "."
        )

    meals = sorted({entry.meal for entry in nutrition_entries})
    if nutrition_entries:
        nutrition_lines = [
            f"Totals: {nutrition_totals.calories} kcal, "
            f"{nutrition_totals.protein_g:g}g protein, "
            f"{nutrition_totals.carbs_g:g}g carbs, "
            f"{nutrition_totals.fat_g:g}g fat, "
            f"{nutrition_totals.fiber_g:g}g fiber.",
            f"Meals logged: {', '.join(meals)}.",
            "Foods: "
            + "; ".join(
                f"{entry.meal} — {entry.name} ({entry.calories} kcal, "
                f"{entry.protein_g:g}g protein)"
                for entry in nutrition_entries
            )
            + ".",
        ]
    else:
        nutrition_lines = ["No nutrition entries logged."]

    goal_lines = []
    for goal in active_goals:
        goal_lines.append(_format_goal_for_coach(goal))
    if not goal_lines:
        goal_lines = ["No active goals logged."]

    workout_block = (
        "\n\n".join(
            _format_session(workout, f"WORKOUT {index + 1}")
            for index, workout in enumerate(workouts)
        )
        if workouts
        else "No workout logged."
    )

    missing = []
    if not weight:
        missing.append("weight")
    if not nutrition_entries:
        missing.append("nutrition")
    if not workouts:
        missing.append("workout")
    if not health_summary:
        missing.append("recovery/activity")
    missing_line = ", ".join(missing) if missing else "none"

    return f"""You are a supportive but candid fitness coach texting a client at the end of one complete day.

DATE: {review_date}

WEIGHT:
{chr(10).join(weight_lines)}

NUTRITION:
{chr(10).join(nutrition_lines)}

ACTIVE GOALS:
{chr(10).join(goal_lines)}

TRAINING:
{workout_block}

RECOVERY & DAILY ACTIVITY:
{_format_apple_health_daily(health_summary)}

MISSING DATA: {missing_line}

Write a personal daily coaching message in 5-7 natural sentences. Interpret the data rather than merely reciting it.
1. Start with a clear, honest overall verdict on the day.
2. Recognize one specific win worth reinforcing, using a relevant number only when it strengthens the point.
3. Identify the single highest-leverage concern or opportunity across weight, nutrition, training, and recovery. Treat sleep, resting heart rate, and HRV as trend signals rather than diagnosing or overreacting to one day. Do not mechanically summarize every category.
4. Give one realistic action for tomorrow with an example of how to execute it using the recorded context when possible.
5. End with brief, earned encouragement that reinforces consistency and sustainable progress.

Be encouraging without empty praise or guilt. Sound like a coach who knows the client, not a database report. Mention only numbers that support a coaching point. Treat a numeric calorie goal as an upper daily budget unless the goal explicitly says otherwise; being moderately below it is not automatically a failure or an incomplete day, and do not encourage eating extra merely to reach the number. Treat protein and fiber goals as targets to reach. Do not characterize an unlogged workout as missed or skipped unless the recorded data explicitly shows that a workout was scheduled or due that day; it may be an intentional rest day. Do not diagnose medical conditions. Do not invent meals, activity, targets, recovery status, or trends. Never label calories or macros as low, high, adequate, or inadequate without a matching numeric goal; if no target exists, report the total neutrally. Do not infer calorie or macro needs from a weight goal. If important data is missing, acknowledge it naturally without letting missing-data disclaimers dominate the message. No bullets, headers, or markdown; output plain prose only."""


def _average_present(rows: list[Any], field: str) -> Optional[float]:
    values = [float(value) for row in rows if (value := getattr(row, field)) is not None]
    return sum(values) / len(values) if values else None


def _format_number(value: float, digits: int = 1) -> str:
    rounded = round(value, digits)
    return f"{rounded:g}"


def _format_health_window(
    rows: list[AppleHealthDailyDB],
    expected_days: int,
) -> str:
    health_fields = (
        "sleep_minutes",
        "awake_minutes",
        "resting_heart_rate_bpm",
        "hrv_ms",
        "steps",
        "active_calories",
        "exercise_minutes",
    )
    observed = [
        row for row in rows
        if any(getattr(row, field) is not None for field in health_fields)
    ]
    lines = [f"Observed health days: {len(observed)}/{expected_days}"]
    averages = (
        ("sleep_minutes", "Average sleep", lambda value: _format_minutes(round(value))),
        ("awake_minutes", "Average awake time", lambda value: _format_minutes(round(value))),
        ("resting_heart_rate_bpm", "Average resting heart rate", lambda value: f"{_format_number(value)} bpm"),
        ("hrv_ms", "Average HRV", lambda value: f"{_format_number(value)} ms"),
        ("steps", "Average steps", lambda value: f"{round(value):,}"),
        ("active_calories", "Average active energy", lambda value: f"{_format_number(value)} kcal"),
        ("exercise_minutes", "Average exercise", lambda value: f"{_format_number(value)} min"),
    )
    for field, label, formatter in averages:
        metric_rows = [row for row in observed if getattr(row, field) is not None]
        if not metric_rows:
            lines.append(
                f"{label}: unavailable (0/{expected_days} observed; sources: none)"
            )
            continue
        value = _average_present(metric_rows, field)
        if value is not None:
            sources = sorted({row.source for row in metric_rows})
            source_text = ", ".join(sources)
            lines.append(
                f"{label}: {formatter(value)} "
                f"({len(metric_rows)}/{expected_days} observed; sources: {source_text})"
            )
    return "\n".join(lines)


def _format_nutrition_window(
    entries: list[NutritionEntryDB],
    expected_days: int,
) -> str:
    by_day: dict[str, dict[str, float]] = {}
    for entry in entries:
        totals = by_day.setdefault(
            entry.date[:10],
            {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0},
        )
        totals["calories"] += entry.calories
        totals["protein"] += entry.protein_g
        totals["carbs"] += entry.carbs_g
        totals["fat"] += entry.fat_g
        totals["fiber"] += entry.fiber_g
    lines = [f"Nutrition logged: {len(by_day)}/{expected_days} days"]
    if not by_day:
        return "\n".join(lines)
    day_totals = list(by_day.values())
    lines.extend((
        f"Average calories: {round(sum(day['calories'] for day in day_totals) / len(day_totals))} kcal",
        f"Average protein: {_format_number(sum(day['protein'] for day in day_totals) / len(day_totals))}g",
        f"Average fiber: {_format_number(sum(day['fiber'] for day in day_totals) / len(day_totals))}g",
    ))
    return "\n".join(lines)


def _format_training_window(
    workouts: list[WorkoutSessionDB],
    expected_days: int,
) -> str:
    del expected_days  # The calendar span is explicit in the surrounding heading.
    duration = sum(workout.duration_minutes for workout in workouts)
    volume = sum(_session_volume(workout) for workout in workouts)
    return (
        f"Workouts: {len(workouts)} sessions, {duration} min\n"
        f"Strength volume: {round(volume):,} lbs"
    )


def _weight_timestamp_order(value: str) -> tuple[int, float | str]:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return (0, value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (1, parsed.astimezone(timezone.utc).timestamp())


def _format_weight_window(
    weights: list[BodyWeightEntryDB],
    expected_days: int,
) -> str:
    daily_latest: dict[str, BodyWeightEntryDB] = {}
    for weight in weights:
        day = weight.date[:10]
        current = daily_latest.get(day)
        if current is None or _weight_timestamp_order(weight.date) > _weight_timestamp_order(current.date):
            daily_latest[day] = weight
    daily_weights = [daily_latest[day] for day in sorted(daily_latest)]

    lines = [
        f"Weight observed days: {len(daily_weights)}/{expected_days} "
        f"({len(weights)} measurements)"
    ]
    sources = sorted({weight.source for weight in weights if weight.source})
    if sources:
        lines.append(f"Weight sources: {', '.join(sources)}")
    if not daily_weights:
        lines.append("Weight trend: no measurements observed")
        return "\n".join(lines)
    first = daily_weights[0]
    latest = daily_weights[-1]
    if len(daily_weights) == 1:
        lines.append(f"Weight trend: one observed day at {latest.weight_lbs:g} lbs")
        return "\n".join(lines)
    change = latest.weight_lbs - first.weight_lbs
    lines.append(
        f"Weight trend: {first.weight_lbs:g} lbs to {latest.weight_lbs:g} lbs "
        f"({change:+g} lbs)"
    )
    return "\n".join(lines)


def _build_weekly_review_prompt(
    *,
    week_start: str,
    week_end: str,
    baseline_start: str,
    baseline_end: str,
    current_health: list[AppleHealthDailyDB],
    baseline_health: list[AppleHealthDailyDB],
    current_nutrition: list[NutritionEntryDB],
    baseline_nutrition: list[NutritionEntryDB],
    current_workouts: list[WorkoutSessionDB],
    baseline_workouts: list[WorkoutSessionDB],
    current_weights: list[BodyWeightEntryDB],
    baseline_weights: list[BodyWeightEntryDB],
    active_goals: list[GoalDB],
) -> str:
    goals = "\n".join(_format_goal_for_coach(goal) for goal in active_goals)
    if not goals:
        goals = "No active goals logged."
    return f"""You are a supportive but candid fitness coach reviewing one complete seven-day period against the client's preceding 28-day personal baseline.

CURRENT 7-DAY WINDOW: {week_start} through {week_end}

RECOVERY & ACTIVITY:
{_format_health_window(current_health, 7)}

NUTRITION:
{_format_nutrition_window(current_nutrition, 7)}

TRAINING:
{_format_training_window(current_workouts, 7)}

WEIGHT:
{_format_weight_window(current_weights, 7)}

PRECEDING 28-DAY BASELINE: {baseline_start} through {baseline_end}

BASELINE RECOVERY & ACTIVITY:
{_format_health_window(baseline_health, 28)}

BASELINE NUTRITION:
{_format_nutrition_window(baseline_nutrition, 28)}

BASELINE TRAINING:
{_format_training_window(baseline_workouts, 28)}

BASELINE WEIGHT:
{_format_weight_window(baseline_weights, 28)}

ACTIVE GOALS:
{goals}

Write a personal weekly coaching review in 5-8 natural sentences with no bullets, headers, or markdown.
1. Start with a clear verdict on the week's overall direction.
2. Identify one evidence-backed win and the single highest-leverage opportunity.
3. Compare the seven-day window with the preceding 28-day baseline only where both windows contain sufficient metric-specific coverage. Treat a current metric as sufficient only with at least 3/7 observed days and its baseline as sufficient only with at least 7/28 observed days; otherwise state that the metric is too sparse to compare. Base conclusions on multi-day patterns, not a single day.
4. Connect recovery, nutrition, weight, and training only when the recorded evidence supports the connection. Do not imply causation from correlation.
5. Give one realistic action for the next week with a concrete execution example.
6. End with brief, earned encouragement.

Do not invent a readiness score; Google/Fitbit readiness remains authoritative if it is ever imported. Do not diagnose medical conditions or overreact to one HRV, resting-heart-rate, or sleep value. Missing data is unknown, not zero. Mention completeness limitations only when they materially weaken a conclusion. Treat calorie targets as upper daily budgets unless the goal explicitly says otherwise; protein and fiber are targets to reach. Do not infer calorie or macro needs from weight direction alone. Do not invent meals, scheduled workouts, symptoms, or goals. Output plain prose only."""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get(
    "/health-data/daily",
    response_model=List[AppleHealthDailyOut],
    response_model_by_alias=True,
)
def list_health_daily(db: Session = Depends(get_db)):
    rows = db.exec(select(AppleHealthDailyDB).order_by(AppleHealthDailyDB.date)).all()
    return [_apple_health_daily_to_out(row) for row in rows]


def _google_health_status(db: Session) -> GoogleHealthStatusOut:
    row = db.get(GoogleHealthConnectionDB, "primary")
    try:
        require_google_health_config()
        configured = True
    except GoogleHealthConfigurationError:
        configured = False
    return GoogleHealthStatusOut(
        connected=bool(row and row.status == "connected" and row.encrypted_refresh_token),
        configured=configured,
        last_success_at=row.last_success_at if row else None,
        last_attempt_at=row.last_attempt_at if row else None,
        last_error=row.last_error if row else None,
        last_sync_count=row.last_sync_count if row else 0,
        last_sync_start=row.last_sync_start if row else None,
        last_sync_end=row.last_sync_end if row else None,
    )


@app.get("/integrations/google-health/oauth/start")
def google_health_oauth_start(db: Session = Depends(get_db)):
    try:
        client_id, _, _ = require_google_health_config()
    except GoogleHealthConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Google Health integration is not configured") from exc
    state = secrets.token_urlsafe(32)
    url, verifier = build_authorization_url(state, client_id)
    db.add(GoogleHealthOAuthStateDB(
        state=state, code_verifier=verifier,
        expires_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
    ))
    db.commit()
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url, status_code=307)


@app.get("/integrations/google-health/oauth/callback")
def google_health_oauth_callback(
    state: str = "", code: str = "", error: str = "", db: Session = Depends(get_db)
):
    from fastapi.responses import HTMLResponse
    safe_failure = "<!doctype html><title>GainLog connection failed</title><p>Connection could not be completed. Return to GainLog and try again.</p>"
    if error or not state or not code:
        return HTMLResponse(safe_failure, status_code=400)
    row = db.get(GoogleHealthOAuthStateDB, state)
    now = datetime.now(timezone.utc)
    if not row or row.consumed_at or datetime.fromisoformat(row.expires_at) <= now:
        return HTMLResponse(safe_failure, status_code=400)
    # Mark consumed before the network exchange so callback replay cannot exchange twice.
    row.consumed_at = now.isoformat()
    db.add(row); db.commit()
    try:
        client_id, client_secret, cipher = require_google_health_config()
        response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={"code": code, "client_id": client_id, "client_secret": client_secret,
                  "redirect_uri": GOOGLE_HEALTH_CALLBACK_URL,
                  "grant_type": "authorization_code", "code_verifier": row.code_verifier},
            timeout=15,
        )
        payload = response.json() if response.ok else {}
        refresh_token = payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise ValueError("refresh token unavailable")
        connection = db.get(GoogleHealthConnectionDB, "primary") or GoogleHealthConnectionDB()
        connection.encrypted_refresh_token = cipher.encrypt(refresh_token)
        connection.status = "connected"; connection.last_error = None
        db.add(connection); db.commit()
    except Exception:
        # Never include provider responses, authorization code, or tokens in output/logs.
        connection = db.get(GoogleHealthConnectionDB, "primary") or GoogleHealthConnectionDB()
        connection.status = "error"; connection.last_error = "Authorization exchange failed"
        db.add(connection); db.commit()
        return HTMLResponse(safe_failure, status_code=400)
    return HTMLResponse("<!doctype html><title>GainLog connected</title><p>Google Health connected. You may return to GainLog.</p>")


@app.get("/integrations/google-health/status", response_model=GoogleHealthStatusOut, response_model_by_alias=True)
def google_health_status(db: Session = Depends(get_db)):
    return _google_health_status(db)


@app.post("/integrations/google-health/sync", response_model=GoogleHealthSyncOut, response_model_by_alias=True)
def google_health_sync(payload: GoogleHealthSyncIn, db: Session = Depends(get_db)):
    try:
        return run_google_health_sync(db, start_date=payload.start_date, end_date=payload.end_date, backfill=payload.backfill)
    except GoogleHealthDataError as exc:
        status = 409 if str(exc) == "Google Health is not connected" else 503
        raise HTTPException(status_code=status, detail="Google Health synchronization failed" if status == 503 else str(exc)) from exc


@app.delete("/integrations/google-health/connection", status_code=204)
def google_health_disconnect(db: Session = Depends(get_db)):
    row = db.get(GoogleHealthConnectionDB, "primary")
    if not row:
        return Response(status_code=204)
    # Revocation is deliberately best-effort; deleting local access is authoritative.
    try:
        _, _, cipher = require_google_health_config()
        if row.encrypted_refresh_token:
            requests.post("https://oauth2.googleapis.com/revoke", params={"token": cipher.decrypt(row.encrypted_refresh_token)}, timeout=10)
    except Exception:
        pass
    db.delete(row); db.commit()
    return Response(status_code=204)


@app.get("/coach/status", response_model=CoachStatusOut, response_model_by_alias=True)
def get_coach_status():
    return _get_coach_status()


@app.get(
    "/coach/daily-review",
    response_model=DailyReviewOut,
    response_model_by_alias=True,
)
def get_daily_review(date: str, db: Session = Depends(get_db)):
    row = db.get(DailyReviewDB, date)
    if not row:
        raise HTTPException(status_code=404, detail="Daily review not found")
    return DailyReviewOut(
        date=row.date,
        review=row.review,
        generated_at=row.generated_at,
    )


@app.post(
    "/coach/daily-review",
    response_model=DailyReviewOut,
    response_model_by_alias=True,
)
def generate_daily_review(date: str, db: Session = Depends(get_db)):
    weight = db.exec(
        select(BodyWeightEntryDB)
        .where(BodyWeightEntryDB.date.startswith(date))
        .order_by(BodyWeightEntryDB.date.desc())
        .limit(1)
    ).first()
    health_summary = db.get(AppleHealthDailyDB, date)
    recent_weights = db.exec(
        select(BodyWeightEntryDB)
        .where(BodyWeightEntryDB.date < date)
        .order_by(BodyWeightEntryDB.date.desc())
        .limit(5)
    ).all()
    nutrition_entries = db.exec(
        select(NutritionEntryDB)
        .where(NutritionEntryDB.date.startswith(date))
        .order_by(NutritionEntryDB.date)
    ).all()
    workouts = db.exec(
        select(WorkoutSessionDB)
        .where(WorkoutSessionDB.date.startswith(date))
        .order_by(WorkoutSessionDB.date)
    ).all()
    active_goals = db.exec(
        select(GoalDB)
        .where(GoalDB.status == "active")
        .order_by(GoalDB.start_date.desc())
    ).all()
    nutrition_totals = _nutrition_totals_for_date(db, date)
    prompt = _build_daily_review_prompt(
        review_date=date,
        weight=weight,
        health_summary=health_summary,
        recent_weights=list(recent_weights),
        nutrition_entries=list(nutrition_entries),
        nutrition_totals=nutrition_totals,
        workouts=list(workouts),
        active_goals=list(active_goals),
    )

    try:
        provider = get_coach_provider()
        review_text = provider.generate(prompt)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Daily review unavailable: {exc}") from exc

    generated_at = datetime.now(timezone.utc).isoformat()
    row = db.get(DailyReviewDB, date)
    if row:
        row.review = review_text
        row.generated_at = generated_at
    else:
        row = DailyReviewDB(
            date=date,
            review=review_text,
            generated_at=generated_at,
        )
    db.add(row)
    db.commit()
    db.refresh(row)
    return DailyReviewOut(
        date=row.date,
        review=row.review,
        generated_at=row.generated_at,
    )


def _parse_week_end(value: str) -> date_cls:
    try:
        parsed = date_cls.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="weekEnd must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise HTTPException(status_code=422, detail="weekEnd must use YYYY-MM-DD")
    return parsed


def _weekly_review_to_out(row: WeeklyReviewDB) -> WeeklyReviewOut:
    return WeeklyReviewOut(
        week_start=row.week_start,
        week_end=row.week_end,
        review=row.review,
        generated_at=row.generated_at,
    )


@app.get(
    "/coach/weekly-review",
    response_model=WeeklyReviewOut,
    response_model_by_alias=True,
)
def get_weekly_review(
    week_end: str = Query(alias="weekEnd"),
    db: Session = Depends(get_db),
):
    _parse_week_end(week_end)
    row = db.get(WeeklyReviewDB, week_end)
    if not row:
        raise HTTPException(status_code=404, detail="Weekly review not found")
    return _weekly_review_to_out(row)


@app.post(
    "/coach/weekly-review",
    response_model=WeeklyReviewOut,
    response_model_by_alias=True,
)
def generate_weekly_review(
    week_end: str = Query(alias="weekEnd"),
    db: Session = Depends(get_db),
):
    parsed_end = _parse_week_end(week_end)
    week_start_date = parsed_end - timedelta(days=6)
    baseline_end_date = week_start_date - timedelta(days=1)
    baseline_start_date = baseline_end_date - timedelta(days=27)
    week_start = week_start_date.isoformat()
    baseline_start = baseline_start_date.isoformat()
    baseline_end = baseline_end_date.isoformat()
    current_end_exclusive = (parsed_end + timedelta(days=1)).isoformat()
    baseline_end_exclusive = week_start

    current_health = list(db.exec(
        select(AppleHealthDailyDB)
        .where(AppleHealthDailyDB.date >= week_start, AppleHealthDailyDB.date <= week_end)
        .order_by(AppleHealthDailyDB.date)
    ).all())
    baseline_health = list(db.exec(
        select(AppleHealthDailyDB)
        .where(
            AppleHealthDailyDB.date >= baseline_start,
            AppleHealthDailyDB.date < baseline_end_exclusive,
        )
        .order_by(AppleHealthDailyDB.date)
    ).all())
    current_nutrition = list(db.exec(
        select(NutritionEntryDB)
        .where(
            NutritionEntryDB.date >= week_start,
            NutritionEntryDB.date < current_end_exclusive,
        )
        .order_by(NutritionEntryDB.date)
    ).all())
    baseline_nutrition = list(db.exec(
        select(NutritionEntryDB)
        .where(
            NutritionEntryDB.date >= baseline_start,
            NutritionEntryDB.date < baseline_end_exclusive,
        )
        .order_by(NutritionEntryDB.date)
    ).all())
    current_workouts = list(db.exec(
        select(WorkoutSessionDB)
        .where(
            WorkoutSessionDB.date >= week_start,
            WorkoutSessionDB.date < current_end_exclusive,
        )
        .order_by(WorkoutSessionDB.date)
    ).all())
    baseline_workouts = list(db.exec(
        select(WorkoutSessionDB)
        .where(
            WorkoutSessionDB.date >= baseline_start,
            WorkoutSessionDB.date < baseline_end_exclusive,
        )
        .order_by(WorkoutSessionDB.date)
    ).all())
    current_weights = list(db.exec(
        select(BodyWeightEntryDB)
        .where(
            BodyWeightEntryDB.date >= week_start,
            BodyWeightEntryDB.date < current_end_exclusive,
        )
        .order_by(BodyWeightEntryDB.date)
    ).all())
    baseline_weights = list(db.exec(
        select(BodyWeightEntryDB)
        .where(
            BodyWeightEntryDB.date >= baseline_start,
            BodyWeightEntryDB.date < baseline_end_exclusive,
        )
        .order_by(BodyWeightEntryDB.date)
    ).all())
    active_goals = list(db.exec(
        select(GoalDB)
        .where(GoalDB.status == "active")
        .order_by(GoalDB.start_date.desc())
    ).all())

    prompt = _build_weekly_review_prompt(
        week_start=week_start,
        week_end=week_end,
        baseline_start=baseline_start,
        baseline_end=baseline_end,
        current_health=current_health,
        baseline_health=baseline_health,
        current_nutrition=current_nutrition,
        baseline_nutrition=baseline_nutrition,
        current_workouts=current_workouts,
        baseline_workouts=baseline_workouts,
        current_weights=current_weights,
        baseline_weights=baseline_weights,
        active_goals=active_goals,
    )
    try:
        review_text = get_coach_provider(
            model_env_var="GAINLOG_WEEKLY_REVIEW_MODEL",
            default_model="gpt-5.6-sol",
        ).generate(prompt)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Weekly review unavailable") from exc

    generated_at = datetime.now(timezone.utc).isoformat()
    row = db.get(WeeklyReviewDB, week_end)
    if row:
        row.week_start = week_start
        row.review = review_text
        row.generated_at = generated_at
    else:
        row = WeeklyReviewDB(
            week_start=week_start,
            week_end=week_end,
            review=review_text,
            generated_at=generated_at,
        )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _weekly_review_to_out(row)


@app.get("/body-weight/", response_model=List[BodyWeightEntryOut], response_model_by_alias=True)
def list_body_weight(db: Session = Depends(get_db)):
    rows = db.exec(select(BodyWeightEntryDB).order_by(BodyWeightEntryDB.date.desc())).all()
    return [_body_weight_to_out(row) for row in rows]


@app.post("/body-weight/", response_model=BodyWeightEntryOut, response_model_by_alias=True, status_code=201)
def create_body_weight(payload: BodyWeightEntryIn, db: Session = Depends(get_db)):
    entry_id = payload.id or str(uuid.uuid4())
    row = BodyWeightEntryDB(
        id=entry_id,
        date=payload.date,
        weight_lbs=payload.weight_lbs,
        body_fat_percent=payload.body_fat_percent,
        lean_body_mass_lbs=payload.lean_body_mass_lbs,
        bmi=payload.bmi,
        source=payload.source,
        source_record_id=payload.source_record_id,
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    row = db.get(BodyWeightEntryDB, entry_id)
    return _body_weight_to_out(row)


def _upsert_sourced_body_weight(
    payload: BodyWeightEntryIn,
    db: Session,
) -> tuple[BodyWeightEntryDB, bool]:
    if not payload.source:
        raise HTTPException(status_code=422, detail="Import source is required")

    source_record_id = payload.source_record_id or payload.date
    body_fat_percent = payload.body_fat_percent
    if (
        payload.source == "apple-health"
        and body_fat_percent is not None
        and 0 < body_fat_percent <= 1
    ):
        body_fat_percent *= 100

    existing = db.exec(
        select(BodyWeightEntryDB).where(
            BodyWeightEntryDB.source == payload.source,
            BodyWeightEntryDB.source_record_id == source_record_id,
        )
    ).first()
    entry_id = payload.id or str(uuid.uuid4())
    insert_statement = sqlite_insert(BodyWeightEntryDB).values(
        id=entry_id,
        date=payload.date,
        weight_lbs=payload.weight_lbs,
        body_fat_percent=body_fat_percent,
        lean_body_mass_lbs=payload.lean_body_mass_lbs,
        bmi=payload.bmi,
        source=payload.source,
        source_record_id=source_record_id,
        notes=payload.notes,
    )
    upsert_statement = insert_statement.on_conflict_do_update(
        index_elements=["source", "source_record_id"],
        set_={
            "date": insert_statement.excluded.date,
            "weight_lbs": insert_statement.excluded.weight_lbs,
            "body_fat_percent": (
                insert_statement.excluded.body_fat_percent
                if payload.replace_existing
                else func.coalesce(
                    insert_statement.excluded.body_fat_percent,
                    BodyWeightEntryDB.body_fat_percent,
                )
            ),
            "lean_body_mass_lbs": (
                insert_statement.excluded.lean_body_mass_lbs
                if payload.replace_existing
                else func.coalesce(
                    insert_statement.excluded.lean_body_mass_lbs,
                    BodyWeightEntryDB.lean_body_mass_lbs,
                )
            ),
            "bmi": (
                insert_statement.excluded.bmi
                if payload.replace_existing
                else func.coalesce(insert_statement.excluded.bmi, BodyWeightEntryDB.bmi)
            ),
            "notes": func.coalesce(insert_statement.excluded.notes, BodyWeightEntryDB.notes),
        },
    )
    db.exec(upsert_statement)
    row = db.exec(
        select(BodyWeightEntryDB).where(
            BodyWeightEntryDB.source == payload.source,
            BodyWeightEntryDB.source_record_id == source_record_id,
        )
    ).one()
    return row, existing is None and row.id == entry_id


@app.post(
    "/body-weight/import",
    response_model=BodyWeightEntryOut,
    response_model_by_alias=True,
    dependencies=[Depends(require_native_health_import)],
    responses={201: {"model": BodyWeightEntryOut, "description": "Measurement created"}},
)
def import_body_weight(
    payload: BodyWeightEntryIn,
    response: Response,
    db: Session = Depends(get_db),
):
    if not payload.source:
        raise HTTPException(status_code=422, detail="Import source is required")

    source_record_id = payload.source_record_id or payload.date
    body_fat_percent = payload.body_fat_percent
    if (
        payload.source == "apple-health"
        and body_fat_percent is not None
        and 0 < body_fat_percent <= 1
    ):
        body_fat_percent *= 100
    existing = db.exec(
        select(BodyWeightEntryDB).where(
            BodyWeightEntryDB.source == payload.source,
            BodyWeightEntryDB.source_record_id == source_record_id,
        )
    ).first()

    if payload.id and not existing:
        manual_row = db.get(BodyWeightEntryDB, payload.id)
        if manual_row:
            if manual_row.date != payload.date or manual_row.source is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Import id belongs to a different body-weight measurement",
                )
            manual_row.weight_lbs = payload.weight_lbs
            if body_fat_percent is not None:
                manual_row.body_fat_percent = body_fat_percent
            if payload.lean_body_mass_lbs is not None:
                manual_row.lean_body_mass_lbs = payload.lean_body_mass_lbs
            if payload.bmi is not None:
                manual_row.bmi = payload.bmi
            manual_row.source = payload.source
            manual_row.source_record_id = source_record_id
            if payload.notes is not None:
                manual_row.notes = payload.notes
            db.add(manual_row)
            db.commit()
            db.refresh(manual_row)
            response.status_code = 200
            return _body_weight_to_out(manual_row)

    row, created = _upsert_sourced_body_weight(payload, db)
    db.commit()
    response.status_code = 201 if created else 200
    return _body_weight_to_out(row)


@app.post(
    "/health-connect/body-weight/reconcile",
    dependencies=[Depends(require_native_health_import)],
)
def reconcile_health_connect_body_weights(
    payload: HealthConnectBodyWeightReconcileIn,
    db: Session = Depends(get_db),
):
    def parse_boundary(value: str, label: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid {label}") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise HTTPException(status_code=422, detail=f"{label} must include a timezone")
        return parsed

    start = parse_boundary(payload.start_time, "startTime")
    end = parse_boundary(payload.end_time, "endTime")
    if end <= start or end - start > timedelta(days=366):
        raise HTTPException(status_code=422, detail="Invalid Health Connect repair range")
    if any(
        not record_id.startswith("health-connect:weight:")
        for record_id in payload.source_record_ids
    ):
        raise HTTPException(status_code=422, detail="Invalid Health Connect source record ID")

    retained_ids = set(payload.source_record_ids)
    if len(retained_ids) != len(payload.source_record_ids):
        raise HTTPException(status_code=422, detail="Duplicate Health Connect source record ID")
    if (
        payload.observed_record_count is not None
        and payload.observed_record_count != len(retained_ids)
    ):
        raise HTTPException(
            status_code=409,
            detail="Health Connect weight reconciliation is incomplete",
        )
    rows = db.exec(
        select(BodyWeightEntryDB).where(BodyWeightEntryDB.source == "health-connect")
    ).all()
    rows_in_range: list[BodyWeightEntryDB] = []
    for row in rows:
        try:
            recorded_at = datetime.fromisoformat(row.date.replace("Z", "+00:00"))
        except ValueError:
            continue
        if recorded_at.tzinfo is None or recorded_at.utcoffset() is None:
            continue
        if start <= recorded_at < end:
            rows_in_range.append(row)
    would_delete = any(
        row.source_record_id not in retained_ids for row in rows_in_range
    )
    if would_delete and payload.observed_record_count is None:
        raise HTTPException(
            status_code=409,
            detail="Health Connect weight reconciliation requires an authoritative count",
        )

    deleted = 0
    for row in rows_in_range:
        if row.source_record_id not in retained_ids:
            db.delete(row)
            deleted += 1
    db.commit()
    return {"deleted": deleted}


@app.get(
    "/health-connect/repair-state",
    dependencies=[Depends(require_native_health_import)],
)
def get_health_connect_repair_state(db: Session = Depends(get_db)):
    daily_dates = sorted(
        row.date for row in db.exec(select(HealthConnectDailyOwnershipDB)).all()
    )
    body_weight_instants = sorted({
        row.date
        for row in db.exec(
            select(BodyWeightEntryDB).where(BodyWeightEntryDB.source == "health-connect")
        ).all()
        if row.date
    })
    return {
        "dailyDates": daily_dates,
        "bodyWeightInstants": body_weight_instants,
    }


@app.delete(
    "/health-connect/body-weight/{source_record_id}",
    status_code=204,
    dependencies=[Depends(require_native_health_import)],
)
def delete_health_connect_body_weight(
    source_record_id: str,
    db: Session = Depends(get_db),
):
    row = db.exec(
        select(BodyWeightEntryDB).where(
            BodyWeightEntryDB.source == "health-connect",
            BodyWeightEntryDB.source_record_id == source_record_id,
        )
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@app.get(
    "/apple-health/daily",
    response_model=AppleHealthDailyOut,
    response_model_by_alias=True,
)
def get_apple_health_daily(date: str, db: Session = Depends(get_db)):
    row = db.get(AppleHealthDailyDB, date)
    if not row:
        raise HTTPException(status_code=404, detail="Apple Health daily summary not found")
    return _apple_health_daily_to_out(row)


def _upsert_apple_health_daily(
    payload: AppleHealthDailyIn,
    db: Session,
    *,
    source: Literal["apple-health", "health-connect", "google-health"] = "apple-health",
    replace_existing: bool = False,
) -> tuple[AppleHealthDailyDB, bool]:
    metrics = payload.model_dump(exclude={"date", "source"}, exclude_none=True)
    if not metrics and not replace_existing:
        raise HTTPException(status_code=422, detail="At least one health metric is required")

    existing = db.get(AppleHealthDailyDB, payload.date)
    if replace_existing:
        metrics = {
            field: getattr(payload, field)
            for field in AppleHealthDailyIn.model_fields
            if field not in {"date", "source"}
        }

    # Google owns only the wearable fields it actually reconciled. Health
    # Connect and Apple Health remain fallback sources for missing fields, but
    # cannot overwrite an authoritative Google value on a later sync.
    effective_source = source
    google_connection = db.get(GoogleHealthConnectionDB, "primary")
    google_authority_active = bool(
        google_connection and google_connection.encrypted_refresh_token
    )
    if source != "google-health" and google_authority_active:
        snapshot = db.get(GoogleHealthDailySnapshotDB, payload.date)
        authoritative = snapshot
        if authoritative is None and existing and existing.source == "google-health":
            authoritative = existing
        google_values = {
            field: getattr(authoritative, field)
            for field in GOOGLE_OWNED_FIELDS
            if authoritative is not None and getattr(authoritative, field) is not None
        }
        if google_values:
            metrics.update(google_values)
            effective_source = "google-health"

    updated_at = datetime.now(timezone.utc).isoformat()
    if replace_existing and existing:
        for field, value in metrics.items():
            setattr(existing, field, value)
        existing.source = effective_source
        existing.updated_at = updated_at
        db.add(existing)
        return existing, False

    insert_statement = sqlite_insert(AppleHealthDailyDB).values(
        date=payload.date,
        source=effective_source,
        updated_at=updated_at,
        **metrics,
    )
    upsert_statement = insert_statement.on_conflict_do_update(
        index_elements=["date"],
        set_={
            "sleep_minutes": func.coalesce(
                insert_statement.excluded.sleep_minutes,
                AppleHealthDailyDB.sleep_minutes,
            ),
            "deep_sleep_minutes": func.coalesce(
                insert_statement.excluded.deep_sleep_minutes,
                AppleHealthDailyDB.deep_sleep_minutes,
            ),
            "core_sleep_minutes": func.coalesce(
                insert_statement.excluded.core_sleep_minutes,
                AppleHealthDailyDB.core_sleep_minutes,
            ),
            "rem_sleep_minutes": func.coalesce(
                insert_statement.excluded.rem_sleep_minutes,
                AppleHealthDailyDB.rem_sleep_minutes,
            ),
            "awake_minutes": func.coalesce(
                insert_statement.excluded.awake_minutes,
                AppleHealthDailyDB.awake_minutes,
            ),
            "resting_heart_rate_bpm": func.coalesce(
                insert_statement.excluded.resting_heart_rate_bpm,
                AppleHealthDailyDB.resting_heart_rate_bpm,
            ),
            "hrv_ms": func.coalesce(
                insert_statement.excluded.hrv_ms,
                AppleHealthDailyDB.hrv_ms,
            ),
            "steps": func.coalesce(
                insert_statement.excluded.steps,
                AppleHealthDailyDB.steps,
            ),
            "active_calories": func.coalesce(
                insert_statement.excluded.active_calories,
                AppleHealthDailyDB.active_calories,
            ),
            "total_calories": func.coalesce(
                insert_statement.excluded.total_calories,
                AppleHealthDailyDB.total_calories,
            ),
            "exercise_minutes": func.coalesce(
                insert_statement.excluded.exercise_minutes,
                AppleHealthDailyDB.exercise_minutes,
            ),
            "stand_hours": func.coalesce(
                insert_statement.excluded.stand_hours,
                AppleHealthDailyDB.stand_hours,
            ),
            "walking_running_miles": func.coalesce(
                insert_statement.excluded.walking_running_miles,
                AppleHealthDailyDB.walking_running_miles,
            ),
            "source": insert_statement.excluded.source,
            "updated_at": insert_statement.excluded.updated_at,
        },
    )
    db.exec(upsert_statement)
    row = db.get(AppleHealthDailyDB, payload.date)
    return row, existing is None


@app.post(
    "/apple-health/daily/import",
    response_model=AppleHealthDailyOut,
    response_model_by_alias=True,
    dependencies=[Depends(require_native_health_import)],
    responses={201: {"model": AppleHealthDailyOut, "description": "Daily summary created"}},
)
def import_apple_health_daily(
    payload: AppleHealthDailyIn,
    response: Response,
    db: Session = Depends(get_db),
):
    row, created = _upsert_apple_health_daily(payload, db)
    db.commit()
    response.status_code = 201 if created else 200
    return _apple_health_daily_to_out(row)


@app.post(
    "/health-connect/daily/import",
    response_model=AppleHealthDailyOut,
    response_model_by_alias=True,
    dependencies=[Depends(require_native_health_import)],
    responses={201: {"model": AppleHealthDailyOut, "description": "Daily summary created"}},
)
def import_health_connect_daily(
    payload: HealthConnectDailyIn,
    response: Response,
    db: Session = Depends(get_db),
):
    # Health Connect LIGHT is the closest equivalent to the app's existing CORE
    # sleep field. Android has no defensible Apple Stand Hours equivalent.
    apple_shape = AppleHealthDailyIn(
        **payload.model_dump(
            exclude={"light_sleep_minutes", "distance_miles", "replace_existing", "source"},
            exclude_none=True,
        ),
        core_sleep_minutes=payload.light_sleep_minutes,
        walking_running_miles=payload.distance_miles,
    )
    row, created = _upsert_apple_health_daily(
        apple_shape,
        db,
        source="health-connect",
        replace_existing=payload.replace_existing,
    )
    db.merge(HealthConnectDailyOwnershipDB(date=payload.date))
    db.commit()
    db.refresh(row)
    response.status_code = 201 if created else 200
    return _apple_health_daily_to_out(row)


@app.post(
    "/apple-health/auto-export",
    response_model=HealthAutoExportImportOut,
    response_model_by_alias=True,
    dependencies=[Depends(require_native_health_import)],
)
def import_health_auto_export(payload: dict[str, Any], db: Session = Depends(get_db)):
    data = payload.get("data")
    metrics = data.get("metrics") if isinstance(data, dict) else None
    if not isinstance(metrics, list):
        raise HTTPException(status_code=422, detail="Health Auto Export metrics are required")

    daily_records: dict[str, dict[str, Any]] = {}
    body_records: dict[str, dict[str, Any]] = {}
    ignored_metrics: list[str] = []
    recognized_keys = {
        "sleepanalysis",
        "stepcount",
        "activeenergy",
        "activeenergyburned",
        "appleexercisetime",
        "exercisetime",
        "applestandhour",
        "walkingrunningdistance",
        "walkingandrunningdistance",
        "restingheartrate",
        "heartratevariability",
        "bodymass",
        "bodyweight",
        "weightbodymass",
        "bodyfatpercentage",
        "leanbodymass",
        "bodymassindex",
    }

    for metric in metrics:
        if not isinstance(metric, dict) or not isinstance(metric.get("name"), str):
            continue
        name = metric["name"]
        key = _health_auto_export_key(name)
        if key not in recognized_keys:
            if name not in ignored_metrics:
                ignored_metrics.append(name)
            continue
        units = str(metric.get("units") or "")
        samples = metric.get("data")
        if not isinstance(samples, list):
            continue

        for sample in samples:
            if not isinstance(sample, dict):
                continue
            sample_date = _health_auto_export_date(
                sample.get("date") or sample.get("startDate")
            )
            if not sample_date:
                continue

            if key == "sleepanalysis":
                record = daily_records.setdefault(sample_date, {})
                stage_fields = {
                    "deep": "deep_sleep_minutes",
                    "core": "core_sleep_minutes",
                    "rem": "rem_sleep_minutes",
                }
                for source_field, target_field in stage_fields.items():
                    value = sample.get(source_field)
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        record[target_field] = _health_auto_export_minutes(float(value), units)
                total_sleep = sample.get("totalSleep")
                if not isinstance(total_sleep, (int, float)) or isinstance(total_sleep, bool):
                    staged_sleep = sum(
                        float(value)
                        for field in ("core", "deep", "rem")
                        if isinstance((value := sample.get(field)), (int, float))
                        and not isinstance(value, bool)
                    )
                    asleep = sample.get("asleep")
                    total_sleep = staged_sleep or (
                        asleep
                        if isinstance(asleep, (int, float)) and not isinstance(asleep, bool)
                        else None
                    )
                if isinstance(total_sleep, (int, float)) and not isinstance(total_sleep, bool):
                    record["sleep_minutes"] = _health_auto_export_minutes(
                        float(total_sleep), units
                    )
                continue

            quantity = sample.get("qty")
            if not isinstance(quantity, (int, float)) or isinstance(quantity, bool):
                continue
            quantity = float(quantity)

            if key in {
                "bodymass",
                "bodyweight",
                "weightbodymass",
                "bodyfatpercentage",
                "leanbodymass",
                "bodymassindex",
            }:
                record = body_records.setdefault(sample_date, {})
                if key in {"bodymass", "bodyweight", "weightbodymass"}:
                    record["weight_lbs"] = _health_auto_export_pounds(quantity, units)
                    record["timestamp"] = _health_auto_export_timestamp(
                        sample.get("date"), sample_date
                    )
                elif key == "bodyfatpercentage":
                    record["body_fat_percent"] = quantity
                elif key == "leanbodymass":
                    record["lean_body_mass_lbs"] = _health_auto_export_pounds(quantity, units)
                elif key == "bodymassindex":
                    record["bmi"] = quantity
                continue

            record = daily_records.setdefault(sample_date, {})
            if key == "stepcount":
                record["steps"] = int(round(quantity))
            elif key in {"activeenergy", "activeenergyburned"}:
                record["active_calories"] = _health_auto_export_kcal(quantity, units)
            elif key in {"appleexercisetime", "exercisetime"}:
                record["exercise_minutes"] = _health_auto_export_minutes(quantity, units)
            elif key == "applestandhour":
                record["stand_hours"] = int(round(quantity))
            elif key in {"walkingrunningdistance", "walkingandrunningdistance"}:
                record["walking_running_miles"] = _health_auto_export_miles(quantity, units)
            elif key == "restingheartrate":
                record["resting_heart_rate_bpm"] = quantity
            elif key == "heartratevariability":
                record["hrv_ms"] = quantity

    try:
        daily_payloads = [
            AppleHealthDailyIn(date=summary_date, **values)
            for summary_date, values in daily_records.items()
            if values
        ]
        body_payloads = [
            BodyWeightEntryIn(
                date=values.get("timestamp") or f"{measurement_date}T12:00:00",
                weight_lbs=values["weight_lbs"],
                body_fat_percent=values.get("body_fat_percent"),
                lean_body_mass_lbs=values.get("lean_body_mass_lbs"),
                bmi=values.get("bmi"),
                source="apple-health",
                source_record_id=f"health-auto-export:{measurement_date}",
            )
            for measurement_date, values in body_records.items()
            if values.get("weight_lbs") is not None
        ]
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=exc.errors(include_context=False),
        ) from exc

    try:
        for daily_payload in daily_payloads:
            _upsert_apple_health_daily(daily_payload, db)

        for body_payload in body_payloads:
            _upsert_sourced_body_weight(body_payload, db)

        db.commit()
    except Exception:
        db.rollback()
        raise

    return HealthAutoExportImportOut(
        daily_summaries=len(daily_payloads),
        body_measurements=len(body_payloads),
        ignored_metrics=ignored_metrics,
    )


@app.get("/body-weight/{entry_id}", response_model=BodyWeightEntryOut, response_model_by_alias=True)
def get_body_weight(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(BodyWeightEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Body weight entry not found")
    return _body_weight_to_out(row)


@app.delete("/body-weight/{entry_id}", status_code=204)
def delete_body_weight(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(BodyWeightEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Body weight entry not found")
    db.delete(row)
    db.commit()


@app.get("/goals/", response_model=List[GoalOut], response_model_by_alias=True)
def list_goals(db: Session = Depends(get_db)):
    rows = db.exec(select(GoalDB).order_by(GoalDB.start_date.desc())).all()
    return [_goal_to_out(row) for row in rows]


@app.post("/goals/", response_model=GoalOut, response_model_by_alias=True, status_code=201)
def create_goal(payload: GoalIn, db: Session = Depends(get_db)):
    _validate_goal_kind(payload.kind)
    _validate_goal_values(payload.minimum_value, payload.target_value, payload.maximum_value)
    goal_id = payload.id or str(uuid.uuid4())
    row = GoalDB(
        id=goal_id,
        kind=payload.kind,
        title=payload.title,
        target_value=payload.target_value,
        minimum_value=payload.minimum_value,
        maximum_value=payload.maximum_value,
        unit=payload.unit,
        start_date=payload.start_date,
        target_date=payload.target_date,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    row = db.get(GoalDB, goal_id)
    return _goal_to_out(row)


@app.patch("/goals/{goal_id}", response_model=GoalOut, response_model_by_alias=True)
def update_goal(goal_id: str, payload: GoalPatch, db: Session = Depends(get_db)):
    row = db.get(GoalDB, goal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    updates = payload.model_dump(exclude_unset=True)
    _validate_goal_values(
        updates.get("minimum_value", row.minimum_value),
        updates.get("target_value", row.target_value),
        updates.get("maximum_value", row.maximum_value),
    )
    for field, value in updates.items():
        setattr(row, field, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _goal_to_out(row)


@app.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db: Session = Depends(get_db)):
    row = db.get(GoalDB, goal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(row)
    db.commit()


@app.get("/nutrition/", response_model=List[NutritionEntryOut], response_model_by_alias=True)
def list_nutrition(date: Optional[str] = None, db: Session = Depends(get_db)):
    query = select(NutritionEntryDB)
    if date:
        query = query.where(NutritionEntryDB.date.startswith(date))
    rows = db.exec(query.order_by(NutritionEntryDB.date.desc())).all()
    return [_nutrition_to_out(row) for row in rows]


@app.post("/nutrition/", response_model=NutritionEntryOut, response_model_by_alias=True, status_code=201)
def create_nutrition(payload: NutritionEntryIn, db: Session = Depends(get_db)):
    entry_id = payload.id or str(uuid.uuid4())
    row = NutritionEntryDB(
        id=entry_id,
        date=payload.date,
        meal=payload.meal,
        name=payload.name,
        calories=payload.calories,
        protein_g=payload.protein_g,
        carbs_g=payload.carbs_g,
        fat_g=payload.fat_g,
        fiber_g=payload.fiber_g,
        notes=payload.notes,
    )
    db.add(row)
    _queue_nutrition_sync_event(db, "upsert", entry_id, row)
    db.commit()
    row = db.get(NutritionEntryDB, entry_id)
    return _nutrition_to_out(row)


@app.get(
    "/nutrition/sync/bootstrap",
    response_model=NutritionSyncBootstrapOut,
    response_model_by_alias=True,
)
def get_nutrition_sync_bootstrap(
    since: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: Session = Depends(get_db),
):
    # Capture the high-water mark first. Any mutation committed after this read
    # remains above the returned cursor and is picked up by incremental sync.
    latest_cursor = db.exec(select(func.max(NutritionSyncEventDB.cursor))).one() or 0
    rows = db.exec(
        select(NutritionEntryDB)
        .where(NutritionEntryDB.date >= since)
        .order_by(NutritionEntryDB.date.desc())
    ).all()
    return NutritionSyncBootstrapOut(
        entries=[_nutrition_to_out(row) for row in rows],
        latest_cursor=latest_cursor,
    )


@app.get("/nutrition/sync", response_model=NutritionSyncFeedOut, response_model_by_alias=True)
def get_nutrition_sync_feed(
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = db.exec(
        select(NutritionSyncEventDB)
        .where(NutritionSyncEventDB.cursor > after)
        .order_by(NutritionSyncEventDB.cursor)
        .limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    latest_cursor = db.exec(select(func.max(NutritionSyncEventDB.cursor))).one() or 0
    next_cursor = cast(int, page[-1].cursor) if page else after
    events = []
    for row in page:
        entry = None
        if row.payload_json is not None:
            entry = NutritionEntryOut.model_validate(json.loads(row.payload_json))
        events.append(
            NutritionSyncEventOut(
                cursor=cast(int, row.cursor),
                operation=cast(Literal["upsert", "delete"], row.operation),
                entry_id=row.entry_id,
                entry=entry,
            )
        )
    return NutritionSyncFeedOut(
        events=events,
        next_cursor=next_cursor,
        latest_cursor=latest_cursor,
        has_more=has_more,
    )


@app.get("/nutrition/{entry_id}", response_model=NutritionEntryOut, response_model_by_alias=True)
def get_nutrition(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(NutritionEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nutrition entry not found")
    return _nutrition_to_out(row)


@app.patch("/nutrition/{entry_id}", response_model=NutritionEntryOut, response_model_by_alias=True)
def update_nutrition(
    entry_id: str,
    payload: NutritionEntryPatch,
    db: Session = Depends(get_db),
):
    row = db.get(NutritionEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nutrition entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.add(row)
    _queue_nutrition_sync_event(db, "upsert", entry_id, row)
    db.commit()
    db.refresh(row)
    return _nutrition_to_out(row)


@app.delete("/nutrition/{entry_id}", status_code=204)
def delete_nutrition(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(NutritionEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nutrition entry not found")
    db.delete(row)
    _queue_nutrition_sync_event(db, "delete", entry_id)
    db.commit()


@app.get("/dashboard/summary", response_model=DashboardSummaryOut, response_model_by_alias=True)
def get_dashboard_summary(date: Optional[str] = None, db: Session = Depends(get_db)):
    today = date or date_cls.today().isoformat()
    today_health = db.get(AppleHealthDailyDB, today)
    latest_weight = db.exec(
        select(BodyWeightEntryDB).order_by(BodyWeightEntryDB.date.desc()).limit(1)
    ).first()
    active_goals = db.exec(
        select(GoalDB)
        .where(GoalDB.status == "active")
        .order_by(GoalDB.start_date.desc())
    ).all()
    workouts = db.exec(select(WorkoutSessionDB)).all()
    latest_workout = db.exec(
        select(WorkoutSessionDB).order_by(WorkoutSessionDB.date.desc()).limit(1)
    ).first()

    return DashboardSummaryOut(
        latest_weight=_body_weight_to_out(latest_weight) if latest_weight else None,
        today_health=_apple_health_daily_to_out(today_health) if today_health else None,
        active_goals=[_goal_to_out(goal) for goal in active_goals],
        today_nutrition=_nutrition_totals_for_date(db, today),
        workout_count=len(workouts),
        total_workout_volume=sum(_session_volume(workout) for workout in workouts),
        latest_workout=_to_out(latest_workout) if latest_workout else None,
    )


@app.get("/workouts/", response_model=List[WorkoutSessionOut], response_model_by_alias=True)
def list_workouts(db: Session = Depends(get_db)):
    rows = db.exec(select(WorkoutSessionDB).order_by(WorkoutSessionDB.date.desc())).all()
    return [_to_out(r) for r in rows]


@app.post("/workouts/", response_model=WorkoutSessionOut, response_model_by_alias=True, status_code=201)
def create_workout(payload: WorkoutSessionIn, db: Session = Depends(get_db)):
    sid = payload.id or str(uuid.uuid4())
    row = WorkoutSessionDB(
        id=sid,
        date=payload.date,
        duration_minutes=payload.duration_minutes,
        avg_heart_rate=payload.avg_heart_rate,
        active_calories=payload.active_calories,
        total_calories=payload.total_calories,
        strength_duration_minutes=(
            payload.strength_summary.duration_minutes if payload.strength_summary else None
        ),
        strength_avg_heart_rate=(
            payload.strength_summary.avg_heart_rate if payload.strength_summary else None
        ),
        strength_active_calories=(
            payload.strength_summary.active_calories if payload.strength_summary else None
        ),
        strength_total_calories=(
            payload.strength_summary.total_calories if payload.strength_summary else None
        ),
        cardio_duration_minutes=(
            payload.cardio_summary.duration_minutes if payload.cardio_summary else None
        ),
        cardio_avg_heart_rate=(
            payload.cardio_summary.avg_heart_rate if payload.cardio_summary else None
        ),
        cardio_active_calories=(
            payload.cardio_summary.active_calories if payload.cardio_summary else None
        ),
        cardio_total_calories=(
            payload.cardio_summary.total_calories if payload.cardio_summary else None
        ),
        notes=payload.notes,
        template_id=payload.template_id,
        effort=payload.effort,
        pain=payload.pain,
    )
    db.add(row)
    for ex in payload.exercises:
        eid = ex.id or str(uuid.uuid4())
        db_ex = ExerciseDB(
            id=eid,
            name=ex.name,
            kind=ex.kind,
            cardio_duration_minutes=ex.cardio_duration_minutes,
            distance_miles=ex.distance_miles,
            resistance_level=ex.resistance_level,
            session_id=sid,
        )
        db.add(db_ex)
        for s in ex.sets:
            db.add(WorkoutSetDB(
                id=s.id or str(uuid.uuid4()),
                reps=s.reps,
                weight=s.weight,
                exercise_id=eid,
            ))
    db.commit()
    row = db.get(WorkoutSessionDB, sid)
    return _to_out(row)


@app.get("/workouts/{session_id}", response_model=WorkoutSessionOut, response_model_by_alias=True)
def get_workout(session_id: str, db: Session = Depends(get_db)):
    row = db.get(WorkoutSessionDB, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workout not found")
    return _to_out(row)


@app.patch(
    "/workouts/{session_id}/feedback",
    response_model=WorkoutSessionOut,
    response_model_by_alias=True,
)
def update_workout_feedback(
    session_id: str,
    payload: WorkoutFeedbackIn,
    db: Session = Depends(get_db),
):
    row = db.get(WorkoutSessionDB, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workout not found")
    if "effort" in payload.model_fields_set:
        row.effort = payload.effort
    if "pain" in payload.model_fields_set and payload.pain is not None:
        row.pain = payload.pain
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@app.delete("/workouts/{session_id}", status_code=204)
def delete_workout(session_id: str, db: Session = Depends(get_db)):
    row = db.get(WorkoutSessionDB, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workout not found")
    for ex in row.exercises:
        for ws in ex.sets:
            db.delete(ws)
        db.delete(ex)
    db.delete(row)
    db.commit()


@app.post(
    "/workouts/{session_id}/insight",
    response_model=InsightResponse,
    response_model_by_alias=True,
)
def get_insight(session_id: str, db: Session = Depends(get_db)):
    row = db.get(WorkoutSessionDB, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workout not found")

    history = db.exec(
        select(WorkoutSessionDB)
        .where(WorkoutSessionDB.id != session_id)
        .order_by(WorkoutSessionDB.date.desc())
        .limit(4)
    ).all()

    nutrition_date = row.date[:10]
    latest_weight = db.exec(
        select(BodyWeightEntryDB).order_by(BodyWeightEntryDB.date.desc()).limit(1)
    ).first()
    active_weight_goal = db.exec(
        select(GoalDB)
        .where(GoalDB.kind == "weight")
        .where(GoalDB.status == "active")
        .order_by(GoalDB.start_date.desc())
        .limit(1)
    ).first()
    nutrition_totals = _nutrition_totals_for_date(db, nutrition_date)
    broader_context = _format_broader_context(
        latest_weight=latest_weight,
        active_weight_goal=active_weight_goal,
        nutrition_totals=nutrition_totals,
        nutrition_date=nutrition_date,
    )

    prompt = _build_prompt(row, list(history), broader_context)

    try:
        provider = get_coach_provider()
        insight_text = provider.generate(prompt)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI insights unavailable: {exc}") from exc

    coach_insight = _parse_coach_insight(insight_text)
    legacy_insight = _legacy_insight_text(insight_text, coach_insight)
    row.insight = legacy_insight
    row.insight_json = coach_insight.model_dump_json(by_alias=True)
    db.add(row)
    db.commit()
    return InsightResponse(insight=legacy_insight, coach_insight=coach_insight)
