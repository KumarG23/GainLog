export interface CardioTiming {
  cardioStartedAt?: string;
  cardioEndedAt?: string;
  cardioDurationMinutes: string;
}

export function isCardioRunning(timing: Pick<CardioTiming, 'cardioStartedAt' | 'cardioEndedAt'>): boolean {
  return Boolean(timing.cardioStartedAt && !timing.cardioEndedAt && Number.isFinite(Date.parse(timing.cardioStartedAt)));
}

export function elapsedCardioSeconds(start: string, now: number): number {
  const timestamp = Date.parse(start);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1000)) : 0;
}

export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
}

export function startCardio(now: number): CardioTiming {
  return { cardioStartedAt: new Date(now).toISOString(), cardioEndedAt: undefined, cardioDurationMinutes: '' };
}

export function stopCardio(start: string, now: number): Pick<CardioTiming, 'cardioEndedAt' | 'cardioDurationMinutes'> | null {
  const startedAt = Date.parse(start);
  if (!Number.isFinite(startedAt) || now <= startedAt) return null;
  return { cardioEndedAt: new Date(now).toISOString(), cardioDurationMinutes: String(Math.max(1, Math.round((now - startedAt) / 60000))) };
}

// Require exact local calendar components: Date silently rolls invalid dates forward.
export function parseLocalCardioClock(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day ||
    value.getHours() !== hour || value.getMinutes() !== minute) return null;
  return value.toISOString();
}

export function cardioTimingValid(timing: CardioTiming): boolean {
  const { cardioStartedAt: start, cardioEndedAt: end, cardioDurationMinutes: minutes } = timing;
  if (!start && !end) return true;
  if (!start || !end || !/(Z|[+-]\d\d:\d\d)$/.test(start) || !/(Z|[+-]\d\d:\d\d)$/.test(end)) return false;
  const elapsed = Date.parse(end) - Date.parse(start);
  return Number.isFinite(elapsed) && elapsed > 0 && Math.abs(elapsed / 60000 - Number(minutes)) <= 1;
}
