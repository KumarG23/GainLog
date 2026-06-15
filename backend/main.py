import os
import uuid
from contextlib import asynccontextmanager
from datetime import date as date_cls
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import text
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
    notes: Optional[str] = None
    insight: Optional[str] = None
    exercises: List[ExerciseDB] = Relationship(back_populates="session")


class BodyWeightEntryDB(SQLModel, table=True):
    __tablename__ = "body_weight_entry"
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    date: str
    weight_lbs: float
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
    notes: Optional[str] = None


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
    sets: List[WorkoutSetOut]


class ExerciseIn(CamelModel):
    id: Optional[str] = None
    name: str
    sets: List[WorkoutSetIn]


class WorkoutSessionOut(CamelModel):
    id: str
    date: str
    exercises: List[ExerciseOut]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    notes: Optional[str] = None
    insight: Optional[str] = None


class WorkoutSessionIn(CamelModel):
    id: Optional[str] = None
    date: str
    exercises: List[ExerciseIn]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    notes: Optional[str] = None


class BodyWeightEntryOut(CamelModel):
    id: str
    date: str
    weight_lbs: float
    notes: Optional[str] = None


class BodyWeightEntryIn(CamelModel):
    id: Optional[str] = None
    date: str
    weight_lbs: float
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
    notes: Optional[str] = None


class NutritionTotals(CamelModel):
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float


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


# ── App ────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
    # Add insight column to existing databases that predate this field
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE workout_session ADD COLUMN insight TEXT"))
            conn.commit()
        except Exception:
            pass  # Column already exists
    yield


app = FastAPI(title="GainLog API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_out(s: WorkoutSessionDB) -> WorkoutSessionOut:
    return WorkoutSessionOut(
        id=s.id,
        date=s.date,
        duration_minutes=s.duration_minutes,
        avg_heart_rate=s.avg_heart_rate,
        active_calories=s.active_calories,
        notes=s.notes,
        insight=s.insight,
        exercises=[
            ExerciseOut(
                id=e.id,
                name=e.name,
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
        notes=entry.notes,
    )


GOAL_KINDS = {"weight", "calories", "protein", "workout_frequency"}


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
            configured=True,
        )
    if provider == "anthropic":
        return CoachStatusOut(
            provider=provider,
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            configured=bool(os.environ.get("ANTHROPIC_API_KEY")),
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
    )


# ── Insight helpers ────────────────────────────────────────────────────────────

def _session_volume(s: WorkoutSessionDB) -> int:
    return int(sum(ws.weight * ws.reps for ex in s.exercises for ws in ex.sets))


def _format_session(s: WorkoutSessionDB, label: str) -> str:
    lines = [f"{label} ({s.date[:10]}, {s.duration_minutes} min):"]
    for ex in s.exercises:
        sets_str = "  ".join(f"{ws.weight}×{ws.reps}" for ws in ex.sets)
        vol = int(sum(ws.weight * ws.reps for ws in ex.sets))
        lines.append(f"  {ex.name}: {sets_str}  [{vol} lbs volume]")
    if s.avg_heart_rate:
        lines.append(f"  Avg HR: {s.avg_heart_rate} bpm")
    if s.active_calories:
        lines.append(f"  Calories: {s.active_calories} kcal")
    lines.append(f"  Session volume: {_session_volume(s)} lbs")
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
            f"Latest body weight: {latest_weight.weight_lbs:g} lbs on {latest_weight.date[:10]}."
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
            f"{nutrition_totals.fat_g:g}g fat."
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
1. How today's total volume compares to the recent average (use specific numbers and a percentage if history exists).
2. Call out any personal record — a set with more weight or more reps than anything seen in the recent history for that exercise. If none, skip this point.
3. One concrete, specific suggestion for the next session (e.g. add a set, increase weight on a particular exercise, try a new movement).

Rules: be encouraging but direct. Use exact numbers from the data. No bullet points, no headers, no markdown. Output plain prose only."""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/coach/status", response_model=CoachStatusOut, response_model_by_alias=True)
def get_coach_status():
    return _get_coach_status()


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
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    row = db.get(BodyWeightEntryDB, entry_id)
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
def get_dashboard_summary(db: Session = Depends(get_db)):
    today = date_cls.today().isoformat()
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
        notes=payload.notes,
    )
    db.add(row)
    for ex in payload.exercises:
        eid = ex.id or str(uuid.uuid4())
        db_ex = ExerciseDB(id=eid, name=ex.name, session_id=sid)
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
