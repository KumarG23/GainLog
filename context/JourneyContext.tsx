import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../constants/api';
import type { CheckInPatch, DayCheckIn, JourneyPreferences, JourneySnapshot } from '../types/journey';
import { dayKey, daysBefore, isHealthspanEnabled } from '../utils/healthspan';
import { assertDraftRevision, emptyDay, EMPTY_PREFERENCES } from '../utils/dayJourney';

interface JourneyValue {
  now: Date; snapshot: JourneySnapshot | null; check: DayCheckIn; preferences: JourneyPreferences;
  error: string | null; loading: boolean; busy: boolean;
  refresh: () => Promise<void>;
  saveDay: (date: string, patch: CheckInPatch, expectedRevision: number) => Promise<void>;
  clearDay: (date: string, expectedRevision: number) => Promise<void>;
  savePreferences: (patch: Partial<Omit<JourneyPreferences, 'revision'>>, expectedRevision: number) => Promise<void>;
}
const Context = createContext<JourneyValue | null>(null);

export async function journeyRequest<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}/journey${path}`, { ...init, signal, headers: { 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Check-ins and sleep detail need the updated backend. Your existing records are unchanged.');
    if (response.status === 409) throw new Error('This entry changed on another screen. Close and reload before saving again.');
    throw new Error(`Could not ${init.method ? 'save' : 'load'} (${response.status}). Please retry; nothing is queued.`);
  }
  return response.json() as Promise<T>;
}
function validSnapshot(value: JourneySnapshot, date: string) {
  const rating = (n: unknown) => n === null || typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
  return value?.version === 1 && value.endDate === date && Array.isArray(value.days) &&
    value.days.every(d => typeof d.date === 'string' && Number.isInteger(d.revision) && d.revision >= 0 && [d.energy, d.soreness, d.stress].every(rating) &&
      [d.note, d.reflection].every(text => text === null || typeof text === 'string') &&
      (d.trainingIntent === null || d.trainingIntent === 'rest' || d.trainingIntent === 'plan') &&
      typeof d.nutritionReviewed === 'boolean') &&
    value.preferences && Number.isInteger(value.preferences.revision) && value.preferences.revision >= 0 &&
    (value.preferences.focus === null || ['sleep', 'movement', 'strength', 'nutrition', 'stress'].includes(value.preferences.focus)) &&
    (value.preferences.wakeTime === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value.preferences.wakeTime)) &&
    (value.preferences.sleepMinutes === null || Number.isInteger(value.preferences.sleepMinutes) && value.preferences.sleepMinutes >= 300 && value.preferences.sleepMinutes <= 660) &&
    Number.isInteger(value.preferences.windDownMinutes) && value.preferences.windDownMinutes >= 0 && value.preferences.windDownMinutes <= 120;
}
export function JourneyProvider({ children }: React.PropsWithChildren) {
  const [now, setNow] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<JourneySnapshot | null>(null);
  const latest = useRef<JourneySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false), epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const publish = useCallback((value: JourneySnapshot | null) => { latest.current = value; setSnapshot(value); }, []);
  const refresh = useCallback(async () => {
    if (!isHealthspanEnabled() || writing.current) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const ticket = ++epoch.current, date = dayKey();
    if (latest.current?.endDate !== date) publish(null);
    setLoading(true); setError(null);
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const value = await journeyRequest<JourneySnapshot>(`?startDate=${daysBefore(date, 28)[0]}&endDate=${date}`, {}, abort.signal);
      if (!validSnapshot(value, date)) throw new Error('Check-in response is incomplete. Nothing has been changed.');
      if (ticket === epoch.current && date === dayKey()) publish(value);
    } catch (err) { if (ticket === epoch.current) setError(abort.signal.aborted ? 'Check-ins could not be refreshed. Pull to retry.' : err instanceof Error ? err.message : 'Check-ins are unavailable.'); }
    finally { clearTimeout(timeout); if (ticket === epoch.current) setLoading(false); }
  }, [publish]);
  const mutate = useCallback(async (kind: 'day' | 'clear' | 'preferences', date: string, patch: CheckInPatch | Partial<JourneyPreferences>, expectedRevision: number) => {
    if (writing.current) throw new Error('A save is already in progress.');
    const current = latest.current;
    if (!current || error || loading || current.endDate !== dayKey()) throw new Error('Refresh check-ins before saving.');
    const revision = kind === 'preferences' ? current.preferences.revision : current.days.find(d => d.date === date)?.revision ?? 0;
    assertDraftRevision(expectedRevision, revision);
    writing.current = true; setBusy(true); controller.current?.abort(); ++epoch.current; setLoading(false);
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
      const path = kind === 'preferences' ? '/preferences' : `/days/${date}${kind === 'clear' ? `?expectedRevision=${revision}` : `?timeZone=${tz}`}`;
      const value = await journeyRequest<DayCheckIn | JourneyPreferences>(path, { method: kind === 'clear' ? 'DELETE' : 'PATCH', ...(kind === 'clear' ? {} : { body: JSON.stringify({ ...patch, expectedRevision: revision }) }) }, abort.signal);
      if (!Number.isInteger(value.revision) || value.revision !== revision + 1) throw new Error('Save confirmation was incomplete. Reload before trying again.');
      if (kind !== 'preferences' && (value as DayCheckIn).date !== date) throw new Error('Save confirmation returned a different date. Reload before trying again.');
      const next = kind === 'preferences' ? { ...current, preferences: value as JourneyPreferences } : { ...current, days: [...current.days.filter(d => d.date !== date), value as DayCheckIn] };
      if (!validSnapshot(next, current.endDate)) throw new Error('Save confirmation was incomplete. Reload before trying again.');
      publish(current.endDate === dayKey() ? next : null);
    } catch (err) {
      // A lost response may still have committed. Block another write until a fresh read.
      setError('Save could not be confirmed. Refresh before trying again.');
      throw new Error(abort.signal.aborted ? 'Save confirmation timed out. Refresh to check whether it was saved; your draft stays here.' : err instanceof Error ? err.message : 'Save could not be confirmed.');
    } finally { clearTimeout(timeout); writing.current = false; setBusy(false); }
  }, [error, loading, publish]);
  const saveDay = useCallback((date: string, patch: CheckInPatch, revision: number) => mutate('day', date, patch, revision), [mutate]);
  const clearDay = useCallback((date: string, revision: number) => mutate('clear', date, {}, revision), [mutate]);
  const savePreferences = useCallback((patch: Partial<Omit<JourneyPreferences, 'revision'>>, revision: number) => mutate('preferences', '', patch, revision), [mutate]);
  useEffect(() => {
    if (!isHealthspanEnabled()) return;
    void refresh();
    let last = dayKey();
    const tick = () => { const value = new Date(); setNow(value); if (dayKey(value) !== last) { last = dayKey(value); void refresh(); } };
    const timer = setInterval(tick, 60000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') { tick(); void refresh(); } });
    return () => { clearInterval(timer); sub.remove(); ++epoch.current; controller.current?.abort(); };
  }, [refresh]);
  return <Context.Provider value={{ now, snapshot, check: snapshot?.days.find(d => d.date === dayKey(now)) ?? emptyDay(dayKey(now)), preferences: snapshot?.preferences ?? EMPTY_PREFERENCES, error, loading, busy, refresh, saveDay, clearDay, savePreferences }}>{children}</Context.Provider>;
}
export function useJourney() {
  const value = useContext(Context);
  if (!value) throw new Error('JourneyProvider is required');
  return value;
}
