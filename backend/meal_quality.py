"""Confirmed, owner-authored meal quality metadata (never inferred from macros)."""
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo('America/New_York')


def local_day(value: str) -> str:
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return stamp.astimezone(EASTERN).date().isoformat() if stamp.tzinfo else stamp.date().isoformat()


def meal_counts(entries):
    # Multiple food rows can form one dinner; count meals, not tagged ingredients.
    dinners = {(local_day(e.date), e.meal.strip().lower()) for e in entries
               if e.meal.strip().lower() == 'dinner' and 'ultra-processed' in tags_of(e)}
    fish = {(local_day(e.date), e.meal.strip().lower()) for e in entries if 'fatty-fish' in tags_of(e)}
    return len(dinners), len(fish)
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Field as DBField, Session, SQLModel, select

MealTag = Literal['ultra-processed', 'fatty-fish', 'EVOO', 'home-cooked']


class FullDayLogDB(SQLModel, table=True):
    __tablename__ = 'full_day_log'
    day: str = DBField(primary_key=True)
    confirmed: bool


class FullDayInput(BaseModel):
    confirmed: bool


def tags_of(row) -> list[MealTag]:
    return json.loads(row.tags_json or '[]')


def week_counts(db: Session, week_start: date):
    try:
        from .main import NutritionEntryDB
    except ImportError:
        from main import NutritionEntryDB
    end = week_start + timedelta(days=6)
    entries = [e for e in db.exec(select(NutritionEntryDB)).all()
               if week_start.isoformat() <= local_day(e.date) <= end.isoformat()]
    dinners, fish = meal_counts(entries)
    flags = db.exec(select(FullDayLogDB).where(
        FullDayLogDB.day >= week_start.isoformat(), FullDayLogDB.day <= end.isoformat(),
    )).all()
    return {
        'weekStart': week_start.isoformat(), 'weekEnd': end.isoformat(),
        'upfDinners': dinners if entries else None,
        'fattyFishMeals': fish if entries else None,
        'daysLogged': sum(f.confirmed for f in flags) if flags else None,
    }