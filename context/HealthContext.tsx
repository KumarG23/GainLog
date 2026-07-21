import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { API_URL } from '../constants/api';
import { localDateKey } from '../utils/date';
import {
  BodyWeightEntry,
  CoachStatus,
  DailyReview,
  DashboardSummary,
  Goal,
  NutritionEntry,
} from '../types/health';

type CreateBodyWeightEntry = Omit<BodyWeightEntry, 'id'>;
type CreateGoal = Omit<Goal, 'id'>;
type GoalUpdate = Partial<
  Pick<Goal, 'title' | 'targetValue' | 'unit' | 'targetDate' | 'status' | 'notes'>
>;
type CreateNutritionEntry = Omit<NutritionEntry, 'id'>;

interface HealthContextValue {
  bodyWeightEntries: BodyWeightEntry[];
  goals: Goal[];
  nutritionEntries: NutritionEntry[];
  dashboardSummary: DashboardSummary | null;
  coachStatus: CoachStatus | null;
  dailyReview: DailyReview | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchNutritionEntries: (date?: string) => Promise<NutritionEntry[]>;
  generateDailyReview: (date: string) => Promise<DailyReview>;
  addBodyWeightEntry: (data: CreateBodyWeightEntry) => Promise<BodyWeightEntry>;
  deleteBodyWeightEntry: (id: string) => Promise<void>;
  addGoal: (data: CreateGoal) => Promise<Goal>;
  updateGoal: (id: string, data: GoalUpdate) => Promise<Goal>;
  deleteGoal: (id: string) => Promise<void>;
  addNutritionEntry: (data: CreateNutritionEntry) => Promise<NutritionEntry>;
  deleteNutritionEntry: (id: string) => Promise<void>;
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
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [coachStatus, setCoachStatus] = useState<CoachStatus | null>(null);
  const [dailyReview, setDailyReview] = useState<DailyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = localDateKey();
      const [weights, goalsData, nutrition, summary, coach, review] = await Promise.all([
        apiFetch<BodyWeightEntry[]>('/body-weight/'),
        apiFetch<Goal[]>('/goals/'),
        apiFetch<NutritionEntry[]>('/nutrition/'),
        apiFetch<DashboardSummary>(
          `/dashboard/summary?date=${encodeURIComponent(today)}`,
        ),
        apiFetch<CoachStatus>('/coach/status').catch(() => null),
        apiFetch<DailyReview>(
          `/coach/daily-review?date=${encodeURIComponent(today)}`,
        ).catch(() => null),
      ]);
      setBodyWeightEntries(weights);
      setGoals(goalsData);
      setNutritionEntries(nutrition);
      setDashboardSummary(summary);
      setCoachStatus(coach);
      setDailyReview(review);
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
    await refresh();
    return entry;
  }, [refresh]);

  const deleteNutritionEntry = useCallback(async (id: string) => {
    await apiFetch<void>(`/nutrition/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const generateDailyReview = useCallback(async (date: string) => {
    const review = await apiFetch<DailyReview>(
      `/coach/daily-review?date=${encodeURIComponent(date)}`,
      { method: 'POST' },
    );
    setDailyReview(review);
    return review;
  }, []);

  return (
    <HealthContext.Provider
      value={{
        bodyWeightEntries,
        goals,
        nutritionEntries,
        dashboardSummary,
        coachStatus,
        dailyReview,
        loading,
        error,
        refresh,
        fetchNutritionEntries,
        generateDailyReview,
        addBodyWeightEntry,
        deleteBodyWeightEntry,
        addGoal,
        updateGoal,
        deleteGoal,
        addNutritionEntry,
        deleteNutritionEntry,
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
