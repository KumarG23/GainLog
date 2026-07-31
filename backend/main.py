import os
import uuid
from contextlib import asynccontextmanager
from datetime import date as date_cls, datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select

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
    strength_duration_minutes: Optional[int] = None
    strength_avg_heart_rate: Optional[int] = None
    strength_active_calories: Optional[int] = None
    cardio_duration_minutes: Optional[int] = None
    cardio_avg_heart_rate: Optional[int] = None
    cardio_active_calories: Optional[int] = None
    notes: Optional[str] = None
    insight: Optional[str] = None
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


class GoalDB(SQLModel, table=True):
    __tablename__ = "goal"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    kind: str
    title: str
    target_value: Optional[float] = None
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


class DailyReviewDB(SQLModel, table=True):
    __tablename__ = "daily_review"
    date: str = Field(primary_key=True)
    review: str
    generated_at: str


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


class WorkoutSessionOut(CamelModel):
    id: str
    date: str
    exercises: List[ExerciseOut]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    strength_summary: Optional[ActivitySummary] = None
    cardio_summary: Optional[ActivitySummary] = None
    notes: Optional[str] = None
    insight: Optional[str] = None


class WorkoutSessionIn(CamelModel):
    id: Optional[str] = None
    date: str
    exercises: List[ExerciseIn]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    strength_summary: Optional[ActivitySummary] = None
    cardio_summary: Optional[ActivitySummary] = None
    notes: Optional[str] = None


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
    source: Optional[Literal["apple-health", "renpho-csv", "manual"]] = None
    source_record_id: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = None


class GoalOut(CamelModel):
    id: str
    kind: str
    title: str
    target_value: Optional[float] = None
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
    unit: Optional[str] = None
    start_date: str
    target_date: Optional[str] = None
    status: str = "active"
    notes: Optional[str] = None


class GoalPatch(CamelModel):
    title: Optional[str] = None
    target_value: Optional[float] = None
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


class NutritionTotals(CamelModel):
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float


class DashboardSummaryOut(CamelModel):
    latest_weight: Optional[BodyWeightEntryOut]
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


class InsightResponse(BaseModel):
    insight: str


class DailyReviewOut(CamelModel):
    date: str
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
            "ALTER TABLE workout_session ADD COLUMN cardio_duration_minutes INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_avg_heart_rate INTEGER",
            "ALTER TABLE workout_session ADD COLUMN cardio_active_calories INTEGER",
            "ALTER TABLE nutrition_entry ADD COLUMN fiber_g REAL DEFAULT 0",
            "ALTER TABLE body_weight_entry ADD COLUMN body_fat_percent REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN lean_body_mass_lbs REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN bmi REAL",
            "ALTER TABLE body_weight_entry ADD COLUMN source TEXT",
            "ALTER TABLE body_weight_entry ADD COLUMN source_record_id TEXT",
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
        conn.commit()
    yield


app = FastAPI(title="GainLog API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_out(s: WorkoutSessionDB) -> WorkoutSessionOut:
    strength_summary = (
        ActivitySummary(
            duration_minutes=s.strength_duration_minutes,
            avg_heart_rate=s.strength_avg_heart_rate,
            active_calories=s.strength_active_calories,
        )
        if s.strength_duration_minutes is not None
        else None
    )
    cardio_summary = (
        ActivitySummary(
            duration_minutes=s.cardio_duration_minutes,
            avg_heart_rate=s.cardio_avg_heart_rate,
            active_calories=s.cardio_active_calories,
        )
        if s.cardio_duration_minutes is not None
        else None
    )
    return WorkoutSessionOut(
        id=s.id,
        date=s.date,
        duration_minutes=s.duration_minutes,
        avg_heart_rate=s.avg_heart_rate,
        active_calories=s.active_calories,
        strength_summary=strength_summary,
        cardio_summary=cardio_summary,
        notes=s.notes,
        insight=s.insight,
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


def _goal_to_out(goal: GoalDB) -> GoalOut:
    return GoalOut(
        id=goal.id,
        kind=goal.kind,
        title=goal.title,
        target_value=goal.target_value,
        unit=goal.unit,
        start_date=goal.start_date,
        target_date=goal.target_date,
        status=goal.status,
        notes=goal.notes,
    )


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


GOAL_KINDS = {"weight", "calories", "protein", "fiber", "workout_frequency"}


def _validate_goal_kind(kind: str) -> None:
    if kind not in GOAL_KINDS:
        allowed = ", ".join(sorted(GOAL_KINDS))
        raise HTTPException(status_code=400, detail=f"Unsupported goal kind. Use one of: {allowed}")


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
        if s.strength_active_calories is not None:
            details.append(f"{s.strength_active_calories} kcal")
        lines.append(f"  Strength session: {', '.join(details)}")
    if s.cardio_duration_minutes is not None:
        details = [f"{s.cardio_duration_minutes} min"]
        if s.cardio_avg_heart_rate is not None:
            details.append(f"Avg HR {s.cardio_avg_heart_rate} bpm")
        if s.cardio_active_calories is not None:
            details.append(f"{s.cardio_active_calories} kcal")
        lines.append(f"  Cardio session: {', '.join(details)}")
    if s.avg_heart_rate:
        lines.append(f"  Avg HR: {s.avg_heart_rate} bpm")
    if s.active_calories:
        lines.append(f"  Calories: {s.active_calories} kcal")
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
        goal = f"Active weight goal: {active_weight_goal.title}"
        if active_weight_goal.target_value is not None:
            unit = f" {active_weight_goal.unit}" if active_weight_goal.unit else ""
            goal += f" targeting {active_weight_goal.target_value:g}{unit}"
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

    return f"""You are a personal trainer AI reviewing a client's workout log.

{current_block}

{context}{broader_context_block}

Write a coaching insight of exactly 2-3 sentences that covers:
1. Compare today's relevant strength or cardio metrics to recent history using specific numbers when comparable history exists.
2. Call out any strength or cardio personal record when the data supports one. If none, skip this point.
3. Give one concrete, specific suggestion for the next session.

Rules: Treat strength and cardio summaries as distinct segments. When both are recorded, discuss both within one combined response instead of merging their heart rate or calorie metrics. Be encouraging but direct. Use exact numbers from the data. No bullet points, no headers, no markdown. Output plain prose only."""


def _build_daily_review_prompt(
    review_date: str,
    weight: Optional[BodyWeightEntryDB],
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
        target = ""
        if goal.target_value is not None:
            unit = f" {goal.unit}" if goal.unit else ""
            target = f": {goal.target_value:g}{unit}"
        goal_lines.append(f"{goal.title}{target}")
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

MISSING DATA: {missing_line}

Write a personal daily coaching message in 5-7 natural sentences. Interpret the data rather than merely reciting it.
1. Start with a clear, honest overall verdict on the day.
2. Recognize one specific win worth reinforcing, using a relevant number only when it strengthens the point.
3. Identify the single highest-leverage concern or opportunity across weight, nutrition, training, and recovery. Do not mechanically summarize every category.
4. Give one realistic action for tomorrow with an example of how to execute it using the recorded context when possible.
5. End with brief, earned encouragement that reinforces consistency and sustainable progress.

Be encouraging without empty praise or guilt. Sound like a coach who knows the client, not a database report. Mention only numbers that support a coaching point. Treat a numeric calorie goal as an upper daily budget unless the goal explicitly says otherwise; being moderately below it is not automatically a failure or an incomplete day, and do not encourage eating extra merely to reach the number. Treat protein and fiber goals as targets to reach. Do not characterize an unlogged workout as missed or skipped unless the recorded data explicitly shows that a workout was scheduled or due that day; it may be an intentional rest day. Do not diagnose medical conditions. Do not invent meals, activity, targets, recovery status, or trends. Never label calories or macros as low, high, adequate, or inadequate without a matching numeric goal; if no target exists, report the total neutrally. Do not infer calorie or macro needs from a weight goal. If important data is missing, acknowledge it naturally without letting missing-data disclaimers dominate the message. No bullets, headers, or markdown; output plain prose only."""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


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


@app.post(
    "/body-weight/import",
    response_model=BodyWeightEntryOut,
    response_model_by_alias=True,
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
            if payload.body_fat_percent is not None:
                manual_row.body_fat_percent = payload.body_fat_percent
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

    entry_id = payload.id or str(uuid.uuid4())
    insert_statement = sqlite_insert(BodyWeightEntryDB).values(
        id=entry_id,
        date=payload.date,
        weight_lbs=payload.weight_lbs,
        body_fat_percent=payload.body_fat_percent,
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
            "body_fat_percent": func.coalesce(
                insert_statement.excluded.body_fat_percent,
                BodyWeightEntryDB.body_fat_percent,
            ),
            "lean_body_mass_lbs": func.coalesce(
                insert_statement.excluded.lean_body_mass_lbs,
                BodyWeightEntryDB.lean_body_mass_lbs,
            ),
            "bmi": func.coalesce(insert_statement.excluded.bmi, BodyWeightEntryDB.bmi),
            "notes": func.coalesce(insert_statement.excluded.notes, BodyWeightEntryDB.notes),
        },
    )
    db.exec(upsert_statement)
    db.commit()
    row = db.exec(
        select(BodyWeightEntryDB).where(
            BodyWeightEntryDB.source == payload.source,
            BodyWeightEntryDB.source_record_id == source_record_id,
        )
    ).one()

    if existing or row.id != entry_id:
        response.status_code = 200
    else:
        response.status_code = 201
    return _body_weight_to_out(row)


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
    goal_id = payload.id or str(uuid.uuid4())
    row = GoalDB(
        id=goal_id,
        kind=payload.kind,
        title=payload.title,
        target_value=payload.target_value,
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
    db.commit()
    row = db.get(NutritionEntryDB, entry_id)
    return _nutrition_to_out(row)


@app.get("/nutrition/{entry_id}", response_model=NutritionEntryOut, response_model_by_alias=True)
def get_nutrition(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(NutritionEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nutrition entry not found")
    return _nutrition_to_out(row)


@app.delete("/nutrition/{entry_id}", status_code=204)
def delete_nutrition(entry_id: str, db: Session = Depends(get_db)):
    row = db.get(NutritionEntryDB, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nutrition entry not found")
    db.delete(row)
    db.commit()


@app.get("/dashboard/summary", response_model=DashboardSummaryOut, response_model_by_alias=True)
def get_dashboard_summary(date: Optional[str] = None, db: Session = Depends(get_db)):
    today = date or date_cls.today().isoformat()
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
        strength_duration_minutes=(
            payload.strength_summary.duration_minutes if payload.strength_summary else None
        ),
        strength_avg_heart_rate=(
            payload.strength_summary.avg_heart_rate if payload.strength_summary else None
        ),
        strength_active_calories=(
            payload.strength_summary.active_calories if payload.strength_summary else None
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
        notes=payload.notes,
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


@app.post("/workouts/{session_id}/insight", response_model=InsightResponse)
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

    row.insight = insight_text
    db.add(row)
    db.commit()
    return InsightResponse(insight=insight_text)
