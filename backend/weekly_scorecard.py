"""Monday–Sunday Eastern scorecards built from persisted evidence, not inferred adherence."""
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

EASTERN = ZoneInfo('America/New_York')
router = APIRouter(prefix='/longevity/scorecard', tags=['longevity'])


def build(db: Session, start: date, today: date | None = None):
    try:
        from .health_hub import project, _analysis, local_date
        from .main import AppleHealthDailyDB, WeeklyReviewDB, WorkoutSessionDB, GoalDB
        from .supplements import SupplementDB, SupplementTakenDB
    except ImportError:
        from health_hub import project, _analysis, local_date
        from main import AppleHealthDailyDB, WeeklyReviewDB, WorkoutSessionDB, GoalDB
        from supplements import SupplementDB, SupplementTakenDB
    today = today or datetime.now(EASTERN).date()
    if start.weekday() or start > today:
        raise HTTPException(422, 'weekStart must be a non-future Monday')
    end = start + timedelta(days=6)
    # Averages exclude today's unfinished day. Session and checklist counts are as-of now.
    closed_end = min(end, today - timedelta(days=1))
    projection = project(db)
    daily = {r[0]: r for r in projection['Daily']}
    days = [(start + timedelta(days=i)).isoformat() for i in range(7)]
    closed = [d for d in days if d <= closed_end.isoformat()]
    observed = [daily[d] for d in closed if d in daily]
    full = [r for r in observed if r[24] == 'Y']
    goals = db.exec(select(GoalDB).where(GoalDB.status == 'active')).all()

    def goal_range(kind, fallback):
        g = next((g for g in goals if g.kind == kind), None)
        if not g:
            return fallback
        return (g.minimum_value if g.minimum_value is not None else g.target_value or fallback[0],
                g.maximum_value if g.maximum_value is not None else g.target_value or fallback[1])

    def avg(index, source=observed):
        values = [r[index] for r in source if r[index] != '']
        return (round(sum(values) / len(values), 2) if values else None, len(values))

    rows = []

    def add(key, label, value, target, good, n=0, note='', partial=False):
        status = 'amber' if value is None or partial else ('green' if good else 'red')
        rows.append({'key': key, 'label': label, 'value': value, 'target': target,
                     'status': status, 'observations': n, 'note': note})

    sleep, n = avg(5)
    add('sleep', 'Sleep average (hours)', round(sleep / 60, 2) if sleep is not None else None,
        '≥7 h', sleep is not None and sleep >= 420, n, 'Completed days only')
    cpap = [r[6] for r in observed if r[6] != '']
    six = sum(v >= 6 for v in cpap) if cpap else None
    add('cpap', 'CPAP nights ≥6 hours', six, '7/7 nights', six == 7, len(cpap),
        'Missing nights remain unknown; denominator is 7 calendar nights', partial=end >= today)
    workouts = [w for w in db.exec(select(WorkoutSessionDB)).all()
                if start.isoformat() <= local_date(w.date) <= min(end, today).isoformat()]
    strength = sum(bool(w.strength_duration_minutes and w.strength_duration_minutes > 0) for w in workouts)
    # Template ID stays recovery for Wednesday; performed segment identities are the evidence.
    intervals = sum(any(ex.kind == 'cardio' and 'Hard interval' in ex.name
                        and ex.cardio_duration_minutes and ex.cardio_duration_minutes > 0
                        for ex in w.exercises) for w in workouts)
    add('strength', 'Strength sessions', strength if workouts else None, '4', strength >= 4,
        len(workouts), partial=end >= today and strength < 4)
    add('intervals', 'Interval sessions', intervals if workouts else None, '1', intervals >= 1,
        len(workouts), partial=end >= today and intervals < 1)
    zones = [_analysis(w).get('zone2Minutes') for w in workouts
             if _analysis(w).get('windowSource') == 'recorded']
    zones = [v for v in zones if v is not None]
    zone = round(sum(zones), 2) if zones else None
    add('zone2', 'Covered zone-2 minutes', zone, '≥150', zone is not None and zone >= 150,
        len(zones), 'Only explicitly timed, sufficiently covered sessions count',
        partial=end >= today and (zone is None or zone < 150))
    steps, n = avg(8)
    add('steps', 'Steps average', steps, '≥8,000', steps is not None and steps >= 8000, n)
    rhr, n = avg(3)
    prior = [daily[d.isoformat()] for i in range(7) if (d := start - timedelta(days=i+1)).isoformat() in daily]
    prev_rhr, _ = avg(3, prior)
    add('rhr', 'Resting HR average', rhr, 'Trending down; reference ≤60 bpm',
        rhr is not None and (rhr <= 60 or prev_rhr is not None and rhr < prev_rhr), n,
        'Trend vs previous week; reference is not a diagnosis')
    hrv, n = avg(4)
    baseline_rows = db.exec(select(AppleHealthDailyDB).where(
        AppleHealthDailyDB.date >= (start-timedelta(days=28)).isoformat(),
        AppleHealthDailyDB.date < start.isoformat())).all()
    baseline = [h.hrv_ms for h in baseline_rows if h.hrv_ms is not None]
    base = sum(baseline)/len(baseline) if baseline else None
    add('hrv', 'HRV average', hrv, 'Up vs preceding 4-week baseline',
        hrv is not None and base is not None and hrv > base, n,
        f'Baseline: {round(base, 2)} ms' if base is not None else 'Baseline missing',
        partial=base is None)
    weight, n = avg(1)
    prev_weight, pn = avg(1, prior)
    delta = round(weight-prev_weight, 2) if weight is not None and prev_weight is not None else None
    add('weight', 'Weight average change (lb)', delta, '−1 to −0.5 lb/week',
        delta is not None and -1 <= delta <= -.5, n,
        f'Current {weight} lb ({n} days); previous {prev_weight} lb ({pn} days)' if delta is not None else 'Comparable prior-week readings missing')
    for key, label, index, bounds in [('protein', 'Protein average (g)', 17, goal_range('protein', (160, 180))),
                                       ('fiber', 'Fiber average (g)', 20, goal_range('fiber', (30, 40)))]:
        value, n = avg(index, full)
        lo, hi = bounds
        add(key, label, value, f'{lo:g}–{hi:g} g', value is not None and lo <= value <= hi, n,
            'Only explicitly confirmed fully logged days')
    calories, n = avg(16, full)
    cap = goal_range('calories', (0, 2300))[1]
    add('calories', 'Calories average', calories, f'≤{cap:g} kcal', calories is not None and calories <= cap,
        n, 'Upper budget, not an amount to eat up to; fully logged days only')
    weekly = next((r for r in projection['Weekly'] if r[0] == start.isoformat()), None)
    for key, label, col, target, check in [('upf', 'UPF dinners', 17, '≤2', lambda v: v <= 2),
                                            ('fish', 'Fatty-fish meals', 18, '2', lambda v: v >= 2),
                                            ('logged', 'Fully logged days', 13, '7/7', lambda v: v == 7)]:
        value = weekly[col] if weekly and weekly[col] != '' else None
        add(key, label, value, target, value is not None and check(value), len(full),
            'Confirmed metadata only; untagged is not proof of absence',
            partial=(key == 'upf' and len(full) < 7) or (end >= today and (value is None or not check(value))))
    sys, ns = avg(14)
    dia, _ = avg(15)
    add('bp', 'Blood pressure average', f'{sys:g}/{dia:g}' if sys is not None and dia is not None else None,
        '<120/80', sys is not None and dia is not None and sys < 120 and dia < 80, ns,
        'Average of recorded daily session averages')
    items = db.exec(select(SupplementDB)).all()
    taken = {(t.supplement_id, t.day): t.taken for t in db.exec(select(SupplementTakenDB)).all()}
    scheduled = [(s, d) for s in items for d in closed if s.starts_on <= d <= (s.ends_on or '9999-12-31')]
    adherence = round(100*sum(taken.get((s.id, d), False) for s, d in scheduled)/len(scheduled), 1) if scheduled else None
    add('supplements', 'Supplement adherence (%)', adherence, '≥90%', adherence is not None and adherence >= 90,
        len(scheduled), 'Scheduled doses on completed days; not a medication recommendation')
    actions = {
        'sleep': 'Protect a consistent sleep opportunity long enough for at least seven hours.',
        'cpap': 'Aim to use CPAP for the full sleep period each night; log the therapy report.',
        'strength': 'Keep the four planned strength appointments; do not cram missed lifts into Wednesday.',
        'intervals': 'Complete one interval session only when readiness permits; easy cardio remains the fallback.',
        'zone2': 'Add one manageable easy-cardio block toward the weekly total.',
        'steps': 'Add a short daily walk you can repeat.',
        'protein': 'Build one reliable protein-serving habit within your configured daily range.',
        'fiber': 'Adjust one meal toward your configured fiber range without aggravating digestion.',
        'calories': 'Review one recurring calorie-dense extra; do not eat up to the budget.',
        'upf': 'Replace one ultra-processed dinner with a practical home-cooked option.',
        'fish': 'Plan one fatty-fish meal.',
        'logged': 'Confirm full-day food logging before interpreting nutrition averages.',
        'supplements': 'Tie the configured checklist to an existing AM/PM habit.',
    }
    flagged = next((r for r in rows if r['status'] == 'red' and r['key'] in actions), None)
    change = actions[flagged['key']] if flagged else 'Fill one missing source-data gap before adding more targets.'
    saved = db.get(WeeklyReviewDB, end.isoformat())
    return {'weekStart': start.isoformat(), 'weekEnd': end.isoformat(), 'asOf': today.isoformat(),
            'completedDays': len(closed), 'partialWeek': end >= today, 'rows': rows, 'oneChange': change,
            'savedAt': json.loads(saved.scorecard_json).get('savedAt') if saved and saved.scorecard_json else None,
            'savedSnapshot': json.loads(saved.scorecard_json) if saved and saved.scorecard_json else None}


def install(get_db):
    @router.get('')
    def get_card(week_start: date = Query(alias='weekStart'), db: Session = Depends(get_db)):
        return build(db, week_start)

    @router.post('/save')
    def save_card(week_start: date = Query(alias='weekStart'), db: Session = Depends(get_db)):
        try:
            from .main import WeeklyReviewDB
        except ImportError:
            from main import WeeklyReviewDB
        card = build(db, week_start)
        card.pop('savedSnapshot', None)
        stamp = datetime.now(EASTERN).isoformat()
        card['savedAt'] = stamp
        row = db.get(WeeklyReviewDB, card['weekEnd'])
        if row is None:
            row = WeeklyReviewDB(week_end=card['weekEnd'], week_start=card['weekStart'],
                                 review=card['oneChange'], generated_at=stamp)
        row.scorecard_json = json.dumps(card)
        row.one_change = card['oneChange']
        db.add(row)
        db.commit()
        db.refresh(row)
        return {'weekStart': row.week_start, 'weekEnd': row.week_end, 'oneChange': row.one_change,
                'snapshot': json.loads(row.scorecard_json)}
    return router
