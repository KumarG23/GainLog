import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { API_URL } from '../constants/api';
import { localDateKey, previousLocalDateKey } from '../utils/date';
import {
  deleteNutritionEntryFromHealthConnect,
  writeNutritionEntryToHealthConnect,
} from '../utils/healthConnectNutritionBridge';
import { repairAllNutritionToHealthConnect } from '../utils/healthConnectNutritionAutoSync';
import {
  BodyWeightEntry,
  CoachStatus,
  DailyReview,
  DashboardSummary,
  Goal,
  HealthDaily,
  NutritionEntry,
  WeeklyReview,
} from '../types/health';

type CreateBodyWeightEntry = Omit<BodyWeightEntry, 'id'>;
type CreateGoal = Omit<Goal, 'id'>;
type GoalUpdate = Partial<
  Pick<Goal, 'title' | 'targetValue' | 'minimumValue' | 'maximumValue' | 'unit' | 'targetDate' | 'status' | 'notes'>
>;
type CreateNutritionEntry = Omit<NutritionEntry, 'id'>;

interface HealthContextValue {
  bodyWeightEntries: BodyWeightEntry[];
  goals: Goal[];
  nutritionEntries: NutritionEntry[];
  healthDailyEntries: HealthDaily[];
  dashboardSummary: DashboardSummary | null;
  coachStatus: CoachStatus | null;
  dailyReview: DailyReview | null;
  weeklyReview: WeeklyReview | null;
  loading: boolean;
  error: string | null;
  nutritionHealthConnectError: string | null;
  refresh: () => Promise<void>;
  fetchNutritionEntries: (date?: string) => Promise<NutritionEntry[]>;
  generateDailyReview: (date: string) => Promise<DailyReview>;
  generateWeeklyReview: (weekEnd: string) => Promise<WeeklyReview>;
  addBodyWeightEntry: (data: CreateBodyWeightEntry) => Promise<BodyWeightEntry>;
  deleteBodyWeightEntry: (id: string) => Promise<void>;
  addGoal: (data: CreateGoal) => Promise<Goal>;
  updateGoal: (id: string, data: GoalUpdate) => Promise<Goal>;
  deleteGoal: (id: string) => Promise<void>;
  addNutritionEntry: (data: CreateNutritionEntry) => Promise<NutritionEntry>;
  deleteNutritionEntry: (id: string) => Promise<void>;
  syncNutritionToHealthConnect: () => Promise<number>;
}

const HealthContext = createContext<HealthContextValue | undefined>(undefined);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [bodyWeightEntries, setBodyWeightEntries] = useState<BodyWeightEntry[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [nutritionEntries, setNutritionEntries] = useState<NutritionEntry[]>([]);
  const [healthDailyEntries, setHealthDailyEntries] = useState<HealthDaily[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [coachStatus, setCoachStatus] = useState<CoachStatus | null>(null);
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null);
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nutritionHealthConnectError, setNutritionHealthConnectError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = localDateKey();
      const completedWeekEnd = previousLocalDateKey();
      const [weights, goalsData, nutrition, healthDaily, summary, coach, review, weekly] = await Promise.all([
        apiFetch<BodyWeightEntry[]>('/body-weight/'),
        apiFetch<Goal[]>('/goals/'),
        apiFetch<NutritionEntry[]>('/nutrition/'),
        apiFetch<HealthDaily[]>('/health-data/daily'),
        apiFetch<DashboardSummary>(
          `/dashboard/summary?date=${encodeURIComponent(today)}`,
        ),
        apiFetch<CoachStatus>('/coach/status').catch(() => null),
        apiFetch<DailyReview>(
          `/coach/daily-review?date=${encodeURIComponent(today)}`,
        ).catch(() => null),
        apiFetch<WeeklyReview>(
          `/coach/weekly-review?weekEnd=${encodeURIComponent(completedWeekEnd)}`,
        ).catch(() => null),
      ]);
      setBodyWeightEntries(weights);
      setGoals(goalsData);
      setNutritionEntries(nutrition);
      setHealthDailyEntries(healthDaily);
      setDashboardSummary(summary);
      setCoachStatus(coach);
      setDailyReview(review);
      setWeeklyReview(weekly);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load health data. Check your connection.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchNutritionEntries = useCallback(async (date?: string) => {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const entries = await apiFetch<NutritionEntry[]>(`/nutrition/${query}`);
    setNutritionEntries(entries);
    return entries;
  }, []);

  const addBodyWeightEntry = useCallback(async (data: CreateBodyWeightEntry) => {
    const entry = await apiFetch<BodyWeightEntry>('/body-weight/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
    return entry;
  }, [refresh]);

  const deleteBodyWeightEntry = useCallback(async (id: string) => {
    await apiFetch<void>(`/body-weight/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const addGoal = useCallback(async (data: CreateGoal) => {
    const goal = await apiFetch<Goal>('/goals/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refresh();
    return goal;
  }, [refresh]);

  const updateGoal = useCallback(async (id: string, data: GoalUpdate) => {
    const goal = await apiFetch<Goal>(`/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    await refresh();
    return goal;
  }, [refresh]);

  const deleteGoal = useCallback(async (id: string) => {
    await apiFetch<void>(`/goals/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const addNutritionEntry = useCallback(async (data: CreateNutritionEntry) => {
    const entry = await apiFetch<NutritionEntry>('/nutrition/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    try {
      await writeNutritionEntryToHealthConnect(entry);
      setNutritionHealthConnectError(null);
    } catch (err) {
      setNutritionHealthConnectError(
        err instanceof Error ? err.message : 'Meal saved, but Health Connect export failed.',
      );
    }
    await refresh();
    return entry;
  }, [refresh]);

  const deleteNutritionEntry = useCallback(async (id: string) => {
    await apiFetch<void>(`/nutrition/${id}`, { method: 'DELETE' });
    try {
      await deleteNutritionEntryFromHealthConnect(id);
      setNutritionHealthConnectError(null);
    } catch (err) {
      setNutritionHealthConnectError(
        err instanceof Error ? err.message : 'Meal deleted, but Health Connect cleanup failed.',
      );
    }
    await refresh();
  }, [refresh]);

  const syncNutritionToHealthConnect = useCallback(async () => {
    try {
      const written = await repairAllNutritionToHealthConnect();
      setNutritionHealthConnectError(null);
      return written;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Health Connect nutrition sync failed.';
      setNutritionHealthConnectError(message);
      throw new Error(message);
    }
  }, []);

  const generateDailyReview = useCallback(async (date: string) => {
    const review = await apiFetch<DailyReview>(
      `/coach/daily-review?date=${encodeURIComponent(date)}`,
      { method: 'POST' },
    );
    setDailyReview(review);
    return review;
  }, []);

  const generateWeeklyReview = useCallback(async (weekEnd: string) => {
    const review = await apiFetch<WeeklyReview>(
      `/coach/weekly-review?weekEnd=${encodeURIComponent(weekEnd)}`,
      { method: 'POST' },
    );
    setWeeklyReview(review);
    return review;
  }, []);

  return (
    <HealthContext.Provider
      value={{
        bodyWeightEntries,
        goals,
        nutritionEntries,
        healthDailyEntries,
        dashboardSummary,
        coachStatus,
        dailyReview,
        weeklyReview,
        loading,
        error,
        nutritionHealthConnectError,
        refresh,
        fetchNutritionEntries,
        generateDailyReview,
        generateWeeklyReview,
        addBodyWeightEntry,
        deleteBodyWeightEntry,
        addGoal,
        updateGoal,
        deleteGoal,
        addNutritionEntry,
        deleteNutritionEntry,
        syncNutritionToHealthConnect,
      }}
    >
      {children}
    </HealthContext.Provider>
  );
}

export function useHealth(): HealthContextValue {
  const ctx = useContext(HealthContext);
  if (!ctx) {
    throw new Error('useHealth must be called inside <HealthProvider>');
  }
  return ctx;
}
