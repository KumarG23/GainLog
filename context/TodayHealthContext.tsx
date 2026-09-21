import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../constants/api';
import type { HealthV2Today } from '../types/healthV2';
import { localDay, validTodayPayload } from '../utils/healthspan';

interface TodayState {
  data: HealthV2Today | null;
  fetchedAt: Date | null;
  error: string | null;
  refreshing: boolean;
  refresh: (force?: boolean) => Promise<void>;
}
const Context = createContext<TodayState | null>(null);

/** In-memory only. Refreshes on foreground/date change; no provider sync or model writes. */
export function TodayHealthProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [data, setData] = useState<HealthV2Today | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const last = useRef<{ date: string; time: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const refresh = useCallback((force = false): Promise<void> => {
    if (!enabled) return Promise.resolve();
    const date = localDay();
    if (pending.current && last.current?.date === date) return pending.current;
    if (!force && last.current?.date === date && Date.now() - last.current.time < 60_000) return Promise.resolve();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    last.current = { date, time: 0 };
    setData(previous => previous?.date === date ? previous : null);
    setRefreshing(true); setError(null);
    const task = (async () => {
      const timeout = setTimeout(() => request.abort(), 20_000);
      try {
        const response = await fetch(`${API_URL}/health-v2/today?date=${encodeURIComponent(date)}`, { signal: request.signal });
        if (!response.ok) throw new Error('Health summary unavailable. Pull to refresh or check the connection in Settings.');
        const payload: unknown = await response.json();
        if (!validTodayPayload(payload, date)) throw new Error('The health summary did not match the expected format or date. Please refresh.');
        if (!alive.current || controller.current !== request || localDay() !== date) return;
        const now = new Date();
        setData(payload); setFetchedAt(now); last.current = { date, time: now.getTime() };
      } catch (cause) {
        if (alive.current && controller.current === request) setError(request.signal.aborted ? 'The request timed out. Previously retrieved values may still be shown.' : cause instanceof Error ? cause.message : 'Unable to refresh the health summary.');
      } finally {
        clearTimeout(timeout);
        if (alive.current && controller.current === request) { setRefreshing(false); pending.current = null; }
      }
    })();
    pending.current = task;
    return task;
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'background' && last.current?.date !== localDay()) void refresh(true);
    }, 30_000);
    return () => { alive.current = false; controller.current?.abort(); pending.current = null; clearInterval(timer); subscription.remove(); };
  }, [enabled, refresh]);

  return <Context.Provider value={{ data, fetchedAt, error, refreshing, refresh }}>{children}</Context.Provider>;
}
export function useTodayHealth(): TodayState {
  const value = useContext(Context);
  if (!value) throw new Error('useTodayHealth requires TodayHealthProvider');
  return value;
}
