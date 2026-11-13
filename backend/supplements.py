"""Private per-user configured checklist; no regimen embedded in application defaults."""
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Field as DBField, Session, SQLModel, select

EASTERN = ZoneInfo('America/New_York')
router = APIRouter(prefix='/longevity/supplements', tags=['longevity'])


class SupplementDB(SQLModel, table=True):
    __tablename__ = 'supplement'
    id: str = DBField(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str
    dose: str
    period: str
    starts_on: str
    ends_on: str | None = None


class SupplementTakenDB(SQLModel, table=True):
    __tablename__ = 'supplement_taken'
    supplement_id: str = DBField(foreign_key='supplement.id', primary_key=True)
    day: str = DBField(primary_key=True)
    taken: bool


class SupplementInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dose: str = Field(min_length=1, max_length=120)
    period: Literal['AM', 'PM']


class TakenInput(BaseModel):
    taken: bool


def summary(db: Session, day: date):
    items = db.exec(select(SupplementDB).order_by(SupplementDB.period, SupplementDB.name)).all()
    start = day - timedelta(days=6)
    taken = {(r.supplement_id, r.day): r.taken for r in db.exec(select(SupplementTakenDB).where(
        SupplementTakenDB.day >= start.isoformat(), SupplementTakenDB.day <= day.isoformat(),
    )).all()}
    scheduled = [(item, (start + timedelta(days=i)).isoformat()) for item in items for i in range(7)
                 if item.starts_on <= (start + timedelta(days=i)).isoformat() <= (item.ends_on or '9999-12-31')]
    count = sum(taken.get((item.id, d), False) for item, d in scheduled)
    return {'day': day.isoformat(), 'items': [
        {'id': item.id, 'name': item.name, 'dose': item.dose, 'period': item.period,
         'startsOn': item.starts_on, 'endsOn': item.ends_on, 'taken': taken.get((item.id, day.isoformat()), False)}
        for item in items if item.starts_on <= day.isoformat() and item.ends_on is None],
        'adherence7': round(100 * count / len(scheduled), 1) if scheduled else None,
        'taken7': count, 'scheduled7': len(scheduled)}


def install(get_db):
    @router.get('')
    def get_items(day: date | None = None, db: Session = Depends(get_db)):
        return summary(db, day or datetime.now(EASTERN).date())

    @router.post('', status_code=201)
    def create(payload: SupplementInput, db: Session = Depends(get_db)):
        item = SupplementDB(name=payload.name.strip(), dose=payload.dose.strip(), period=payload.period,
                            starts_on=datetime.now(EASTERN).date().isoformat())
        if not item.name or not item.dose: raise HTTPException(422, 'name and dose required')
        db.add(item); db.commit(); db.refresh(item)
        return {'id': item.id}

    @router.put('/{item_id}')
    def edit(item_id: str, payload: SupplementInput, db: Session = Depends(get_db)):
        item = db.get(SupplementDB, item_id)
        if not item or item.ends_on: raise HTTPException(404, 'active supplement not found')
        if not payload.name.strip() or not payload.dose.strip(): raise HTTPException(422, 'name and dose required')
        item.name, item.dose, item.period = payload.name.strip(), payload.dose.strip(), payload.period
        db.add(item); db.commit()
        return {'id': item.id}

    @router.delete('/{item_id}', status_code=204)
    def archive(item_id: str, db: Session = Depends(get_db)):
        item = db.get(SupplementDB, item_id)
        if not item: raise HTTPException(404, 'supplement not found')
        item.ends_on = datetime.now(EASTERN).date().isoformat()
        db.add(item); db.commit()

    @router.put('/{item_id}/taken/{day}')
    def mark(item_id: str, day: date, payload: TakenInput, db: Session = Depends(get_db)):
        item = db.get(SupplementDB, item_id)
        if not item or not item.starts_on <= day.isoformat() <= (item.ends_on or '9999-12-31'):
            raise HTTPException(404, 'supplement not scheduled on day')
        if day > datetime.now(EASTERN).date(): raise HTTPException(422, 'cannot mark future day')
        row = db.get(SupplementTakenDB, (item_id, day.isoformat())) or SupplementTakenDB(supplement_id=item_id, day=day.isoformat(), taken=False)
        row.taken = payload.taken
        db.add(row); db.commit()
        return {'supplementId': item_id, 'day': day.isoformat(), 'taken': row.taken}

    return router