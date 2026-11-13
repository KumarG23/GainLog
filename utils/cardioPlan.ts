import type { HealthDaily } from '../types/health';

export interface IntervalSegment { name: string; minutes: number; instruction: string }

// The hard effort is a perceived-effort cue; age-predicted max HR is not a measured threshold.
export function intervalProtocol(rounds: 3 | 4 = 4): IntervalSegment[] {
  const segments: IntervalSegment[] = [
    { name: 'Warm-up', minutes: 10, instruction: 'Easy conversational pace; use your editable zone 2 band as guidance.' },
  ];
  for (let round = 1; round <= rounds; round++) {
    segments.push({ name: `Hard interval ${round}`, minutes: 4,
      instruction: 'Treadmill incline · hard but controlled; about 85–95% of estimated maximum HR is only a rough guide.' });
    if (round < rounds) segments.push({ name: `Easy recovery ${round}`, minutes: 3, instruction: 'Slow down to an easy conversational effort.' });
  }
  segments.push({ name: 'Cool-down', minutes: 5, instruction: 'Easy pace.' });
  return segments;
}

export interface ReadinessAdvice { status: 'swap' | 'unknown' | 'clear'; reasons: string[] }

// Use the most recent completed night and *preceding* seven calendar days, never today's
// partial row. An absent datum or insufficient baseline is unknown, not a healthy signal.
export function intervalReadiness(entries: readonly HealthDaily[], now: Date): ReadinessAdvice {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const key = (daysAgo: number) => {
    const date = new Date(day);
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const rows = new Map(entries.map(entry => [entry.date.slice(0, 10), entry]));
  const recent = rows.get(key(1));
  const baseline = Array.from({ length: 7 }, (_, index) => rows.get(key(index + 2)));
  const reasons: string[] = [];
  const unknown: string[] = [];
  if (recent?.sleepMinutes != null && recent.sleepMinutes >= 0) {
    if (recent.sleepMinutes < 360) reasons.push('Last night’s sleep was under 6 hours');
  } else unknown.push('sleep');
  for (const [field, label, isLow] of [
    ['hrvMs', 'HRV', true], ['restingHeartRateBpm', 'resting HR', false],
  ] as const) {
    const value = recent?.[field];
    const values = baseline.map(row => row?.[field]);
    if (value == null || !Number.isFinite(value) || values.some(item => item == null || !Number.isFinite(item)) ||
        values.some(item => (item ?? 0) <= 0)) { unknown.push(label); continue; }
    const average = values.reduce<number>((sum, item) => sum + (item ?? 0), 0) / 7;
    if (isLow ? value < average * 0.85 : value >= average + 5) {
      reasons.push(isLow ? 'HRV is more than 15% below its 7-day baseline' : 'Resting HR is at least 5 bpm above its 7-day baseline');
    }
  }
  if (reasons.length) return { status: 'swap', reasons };
  if (unknown.length) return { status: 'unknown', reasons: [`Insufficient recent data for ${unknown.join(', ')}`] };
  return { status: 'clear', reasons: [] };
}
