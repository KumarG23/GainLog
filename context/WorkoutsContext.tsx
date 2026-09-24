import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { WorkoutEffort, WorkoutSession } from '../types/workout';
import { API_URL } from '../constants/api';
import { getWorkoutPlanWeekStart, type WorkoutPlanOverrides } from '../utils/workoutTemplates';

interface WorkoutsContextValue {
  sessions: WorkoutSession[];
  loading: boolean;
  error: string | null;
  planOverrides: WorkoutPlanOverrides;
  addSession: (data: Omit<WorkoutSession, 'id'>) => Promise<WorkoutSession>;
  deleteSession: (id: string) => Promise<void>;
  updateFeedback: (
    id: string,
    feedback: { effort?: WorkoutEffort; pain?: boolean },
  ) => Promise<WorkoutSession>;
  getSession: (id: string) => WorkoutSession | undefined;
  refresh: () => Promise<void>;
}

const WorkoutsContext = createContext<WorkoutsContextValue | undefined>(
  undefined,
);

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

export function WorkoutsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planOverrides, setPlanOverrides] = useState<WorkoutPlanOverrides>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const monday = getWorkoutPlanWeekStart(new Date());
      const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      const requests: [Promise<WorkoutSession[]>, Promise<{ weekStart: string; overrides: WorkoutPlanOverrides }>] = [
        apiFetch<WorkoutSession[]>('/workouts/'),
        process.env.EXPO_PUBLIC_GAINLOG_REMOTE_PLAN === '1'
          ? apiFetch<{ weekStart: string; overrides: WorkoutPlanOverrides }>(
              `/workout-plan?weekStart=${weekStart}`,
            )
          : Promise.resolve({ weekStart, overrides: {} }),
      ];
      const [data, plan] = await Promise.all(requests);
      if (plan.weekStart !== weekStart || !plan.overrides || typeof plan.overrides !== 'object') {
        throw new Error('Workout plan unavailable');
      }
      setSessions(data);
      setPlanOverrides(plan.overrides);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load workouts. Check your connection.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSession = useCallback(
    async (data: Omit<WorkoutSession, 'id'>): Promise<WorkoutSession> => {
      const session = await apiFetch<WorkoutSession>('/workouts/', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setSessions(prev => [session, ...prev]);
      return session;
    },
    [],
  );

  const deleteSession = useCallback(async (id: string) => {
    await apiFetch<void>(`/workouts/${id}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateFeedback = useCallback(async (
    id: string,
    feedback: { effort?: WorkoutEffort; pain?: boolean },
  ) => {
    const updated = await apiFetch<WorkoutSession>(`/workouts/${id}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify(feedback),
    });
    setSessions(prev => prev.map(session => session.id === id ? updated : session));
    return updated;
  }, []);

  const getSession = useCallback(
    (id: string) => sessions.find(s => s.id === id),
    [sessions],
  );

  return (
    <WorkoutsContext.Provider
      value={{
        sessions,
        loading,
        error,
        planOverrides,
        addSession,
        deleteSession,
        updateFeedback,
        getSession,
        refresh,
      }}
    >
      {children}
    </WorkoutsContext.Provider>
  );
}

export function useWorkouts(): WorkoutsContextValue {
  const ctx = useContext(WorkoutsContext);
  if (!ctx) {
    throw new Error('useWorkouts must be called inside <WorkoutsProvider>');
  }
  return ctx;
}
