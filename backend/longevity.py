"""Owner-entered BP pairs and CPAP nights; independent of daily wearable ownership."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field as DBField, Session, SQLModel, select

EASTERN = ZoneInfo('America/New_York')
router = APIRouter(prefix='/longevity', tags=['longevity'])

class BPReadingDB(SQLModel, table=True):
    __tablename__ = 'bp_reading'
    id: str = DBField(default_factory=lambda: str(uuid4()), primary_key=True)
    pair_id: str | None = None
    time: str
    day: str
    systolic: int
    diastolic: int
    pulse: int | None = None
    arm: str | None = None
    position: str | None = None
    source: str
    source_record_id: str | None = None

class CPAPNightDB(SQLModel, table=True):
    __tablename__ = 'cpap_night'
    day: str = DBField(primary_key=True)
    hours: float
    ahi: float
    leak_lpm: float | None = None
    mask_off_count: int | None = None

class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda name: ''.join([part.title() if i else part for i, part in enumerate(name.split('_'))]), populate_by_name=True)

class BPInput(Camel):
    time: datetime
    systolic: int = Field(ge=60, le=300)
    diastolic: int = Field(ge=30, le=200)
    pulse: int | None = Field(default=None, ge=25, le=240)
    arm: Literal['left', 'right'] | None = None
    position: Literal['sitting', 'standing', 'lying', 'reclining'] | None = None
    @field_validator('time')
    @classmethod
    def offset_required(cls, value):
        if value.utcoffset() is None:
            raise ValueError('time must include UTC offset')
        return value
    @model_validator(mode='after')
    def pressure_order(self):
        if self.systolic <= self.diastolic:
            raise ValueError('systolic must exceed diastolic')
        return self

class BPPair(Camel):
    readings: list[BPInput] = Field(min_length=2, max_length=2)
    @model_validator(mode='after')
    def spaced(self):
        seconds = abs((self.readings[1].time - self.readings[0].time).total_seconds())
        if not 45 <= seconds <= 180:
            raise ValueError('readings must be 45–180 seconds apart')
        if self.readings[0].time.astimezone(EASTERN).date() != self.readings[1].time.astimezone(EASTERN).date():
            raise ValueError('readings must be on one Eastern calendar day')
        return self

class HCReading(BPInput):
    source_record_id: str = Field(min_length=1, max_length=256)

class CPAPInput(Camel):
    day: date
    hours: float = Field(ge=0, le=24, allow_inf_nan=False)
    ahi: float = Field(ge=0, le=150, allow_inf_nan=False)
    leak_lpm: float | None = Field(default=None, ge=0, le=200, allow_inf_nan=False)
    mask_off_count: int | None = Field(default=None, ge=0, le=100)


def day_of(time: datetime) -> str:
    return time.astimezone(EASTERN).date().isoformat()


def bp_output(row: BPReadingDB):
    return {'id': row.id, 'pairId': row.pair_id, 'time': row.time, 'day': row.day,
            'systolic': row.systolic, 'diastolic': row.diastolic, 'pulse': row.pulse,
            'arm': row.arm, 'position': row.position, 'source': row.source,
            'sourceRecordId': row.source_record_id}


def install(get_db):
    @router.post('/bp/pairs', status_code=201)
    def create_pair(payload: BPPair, db: Session = Depends(get_db)):
        matched = [db.exec(select(BPReadingDB).where(
            BPReadingDB.source == 'manual', BPReadingDB.time == reading.time.isoformat()
        )).first() for reading in payload.readings]
        if all(matched):
            if (matched[0].pair_id == matched[1].pair_id and matched[0].pair_id
                and all(row.systolic == reading.systolic and row.diastolic == reading.diastolic
                        and row.pulse == reading.pulse and row.arm == reading.arm
                        and row.position == reading.position for row, reading in zip(matched, payload.readings))):
                return {'pairId': matched[0].pair_id, 'readings': [bp_output(r) for r in matched]}
        if any(matched):
            raise HTTPException(409, 'reading timestamp already exists; load saved pair')
        pair_id = str(uuid4())
        for reading in payload.readings:
            db.add(BPReadingDB(pair_id=pair_id, time=reading.time.isoformat(), day=day_of(reading.time),
                systolic=reading.systolic, diastolic=reading.diastolic, pulse=reading.pulse,
                arm=reading.arm, position=reading.position, source='manual'))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'reading timestamp already exists; load saved pair')
        return {'pairId': pair_id, 'readings': [bp_output(r) for r in db.exec(select(BPReadingDB).where(BPReadingDB.pair_id == pair_id).order_by(BPReadingDB.time)).all()]}

    @router.post('/bp/health-connect')
    def import_hc(payload: HCReading, db: Session = Depends(get_db)):
        existing = db.exec(select(BPReadingDB).where(BPReadingDB.source == 'health-connect', BPReadingDB.source_record_id == payload.source_record_id)).first()
        # A manual reading written to Health Connect returns with a new native ID.
        when = payload.time.astimezone(timezone.utc)
        candidates = db.exec(select(BPReadingDB).where(BPReadingDB.day == day_of(payload.time), BPReadingDB.source == 'manual')).all()
        if not existing:
            for row in candidates:
                if (abs((datetime.fromisoformat(row.time).astimezone(timezone.utc) - when).total_seconds()) <= 30
                    and row.systolic == payload.systolic and row.diastolic == payload.diastolic):
                    return {'reading': bp_output(row), 'deduplicated': True}
        row = existing or BPReadingDB(source='health-connect', source_record_id=payload.source_record_id)
        row.time, row.day = payload.time.isoformat(), day_of(payload.time)
        row.systolic, row.diastolic, row.pulse = payload.systolic, payload.diastolic, payload.pulse
        row.arm, row.position = payload.arm, payload.position
        db.add(row)
        db.commit()
        db.refresh(row)
        return {'reading': bp_output(row), 'deduplicated': bool(existing)}

    @router.get('/bp')
    def list_bp(days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db)):
        today = datetime.now(EASTERN).date()
        start = (today - timedelta(days=max(days, 30) - 1)).isoformat()
        entries = db.exec(select(BPReadingDB).where(BPReadingDB.day >= start, BPReadingDB.day <= today.isoformat()).order_by(BPReadingDB.time.desc())).all()
        def summary(window):
            eligible = [r for r in entries if r.day >= (today - timedelta(days=window-1)).isoformat()]
            groups = {}
            for row in eligible:
                groups.setdefault(row.pair_id or row.id, []).append(row)
            if not groups: return {'systolic': None, 'diastolic': None, 'sessions': 0}
            return {'systolic': round(sum(sum(r.systolic for r in group)/len(group) for group in groups.values())/len(groups), 1),
                    'diastolic': round(sum(sum(r.diastolic for r in group)/len(group) for group in groups.values())/len(groups), 1),
                    'sessions': len(groups)}
        visible_start = (today - timedelta(days=days - 1)).isoformat()
        return {'readings': [bp_output(row) for row in entries if row.day >= visible_start], 'average7': summary(7), 'average30': summary(30)}

    @router.put('/cpap/{day}')
    def put_cpap(day: date, payload: CPAPInput, db: Session = Depends(get_db)):
        if day != payload.day: raise HTTPException(422, 'path and body day must match')
        if day > datetime.now(EASTERN).date(): raise HTTPException(422, 'therapy night cannot be in the future')
        row = db.get(CPAPNightDB, day.isoformat()) or CPAPNightDB(day=day.isoformat())
        row.hours, row.ahi, row.leak_lpm, row.mask_off_count = payload.hours, payload.ahi, payload.leak_lpm, payload.mask_off_count
        db.add(row)
        db.commit()
        return cpap_output(row)

    @router.get('/cpap')
    def list_cpap(days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db)):
        today = datetime.now(EASTERN).date()
        entries = db.exec(select(CPAPNightDB).where(CPAPNightDB.day >= (today-timedelta(days=max(days,30)-1)).isoformat(), CPAPNightDB.day <= today.isoformat()).order_by(CPAPNightDB.day.desc())).all()
        recent = [r for r in entries if r.day >= (today-timedelta(days=29)).isoformat()]
        observed = len(recent)
        return {'nights': [cpap_output(row) for row in entries if row.day >= (today-timedelta(days=days-1)).isoformat()], 'summary30': {
            'observedNights': observed, 'calendarNights': 30,
            'nights4h': sum(r.hours >= 4 for r in recent), 'nights6h': sum(r.hours >= 6 for r in recent),
            'percent4h': round(sum(r.hours >= 4 for r in recent)/30*100, 1) if observed else None,
            'percent6h': round(sum(r.hours >= 6 for r in recent)/30*100, 1) if observed else None,
            'averageAhi': round(sum(r.ahi for r in recent)/observed, 2) if observed else None,
            'averageHours': round(sum(r.hours for r in recent)/observed, 2) if observed else None}}

    return router

def cpap_output(row: CPAPNightDB):
    return {'day': row.day, 'hours': row.hours, 'ahi': row.ahi, 'leakLpm': row.leak_lpm, 'maskOffCount': row.mask_off_count}
