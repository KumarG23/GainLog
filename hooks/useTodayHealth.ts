import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { API_URL } from '../constants/api';
import type { HealthV2Today } from '../types/healthV2';
import { dayKey } from '../utils/healthspan';

function validPayload(value: unknown, date: string): value is HealthV2Today {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<HealthV2Today>;
  return data.date === date && typeof data.version === 'string' &&
    [data.recovery, data.sleep, data.load].every(metric => metric && typeof metric.state === 'string' && metric.components && typeof metric.components === 'object') &&
    !!data.stress && typeof data.stress.state === 'string' && Array.isArray(data.stress.segments) &&
    data.stress.segments.every(segment => segment && typeof segment.startMinute === 'number' && typeof segment.state === 'string');
}
/** Focus/foreground refresh, rollover handling, cancellation and explicit stale state. */
export function useTodayHealth() {
  const [today, setToday] = useState<HealthV2Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastDay = useRef('');
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = ++sequence.current;
    const abort = new AbortController(); controller.current = abort;
    const date = dayKey();
    if (date !== lastDay.current) setToday(null);
    lastDay.current = date;
    setRefreshing(true); setError(null);
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`${API_URL}/health-v2/today?date=${encodeURIComponent(date)}`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Health request failed (${response.status}).`);
      const data: unknown = await response.json();
      if (!validPayload(data, date)) throw new Error('The health response is incomplete or for a different day.');
      if (current !== sequence.current) return;
      setToday(data); setCheckedAt(new Date());
    } catch (err) {
      if (current === sequence.current) setError(abort.signal.aborted ? 'The health request timed out. Pull to retry.' : err instanceof Error ? err.message : 'Unable to load health data.');
    } finally {
      clearTimeout(timeout);
      if (current === sequence.current) setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const rollover = setInterval(() => { if (AppState.currentState === 'active' && lastDay.current !== dayKey()) void refresh(); }, 60000);
    return () => { subscription.remove(); clearInterval(rollover); ++sequence.current; controller.current?.abort(); };
  }, [refresh]));
  return { today, error, refreshing, checkedAt, refresh };
}
