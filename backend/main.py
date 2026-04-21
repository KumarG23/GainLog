import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlmodel import Field, Relationship, Session, SQLModel, create_engine, select

load_dotenv()

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DATA_DIR}/gainlog.db"
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
    exercises: List[ExerciseDB] = Relationship(back_populates="session")


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


class WorkoutSessionIn(CamelModel):
    id: Optional[str] = None
    date: str
    exercises: List[ExerciseIn]
    duration_minutes: int
    avg_heart_rate: Optional[int] = None
    active_calories: Optional[int] = None
    notes: Optional[str] = None


class InsightResponse(BaseModel):
    insight: str


# ── App ────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
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
        exercises=[
            ExerciseOut(
                id=e.id,
                name=e.name,
                sets=[WorkoutSetOut(id=ws.id, reps=ws.reps, weight=ws.weight) for ws in e.sets],
            )
            for e in s.exercises
        ],
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


def _build_prompt(current: WorkoutSessionDB, history: list[WorkoutSessionDB]) -> str:
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

    return f"""You are a personal trainer AI reviewing a client's workout log.

{current_block}

{context}

Write a coaching insight of exactly 2-3 sentences that covers:
1. How today's total volume compares to the recent average (use specific numbers and a percentage if history exists).
2. Call out any personal record — a set with more weight or more reps than anything seen in the recent history for that exercise. If none, skip this point.
3. One concrete, specific suggestion for the next session (e.g. add a set, increase weight on a particular exercise, try a new movement).

Rules: be encouraging but direct. Use exact numbers from the data. No bullet points, no headers, no markdown. Output plain prose only."""


# ── Routes ────────────────────────────────────────────────────────────────────

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
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI insights not configured")

    row = db.get(WorkoutSessionDB, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workout not found")

    history = db.exec(
        select(WorkoutSessionDB)
        .where(WorkoutSessionDB.id != session_id)
        .order_by(WorkoutSessionDB.date.desc())
        .limit(4)
    ).all()

    prompt = _build_prompt(row, list(history))

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )
    return InsightResponse(insight=message.content[0].text.strip())
