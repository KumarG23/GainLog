import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { WorkoutSession } from '../types/workout';
import { API_URL } from '../constants/api';

interface WorkoutsContextValue {
  sessions: WorkoutSession[];
  loading: boolean;
  error: string | null;
  addSession: (data: Omit<WorkoutSession, 'id'>) => Promise<WorkoutSession>;
  deleteSession: (id: string) => Promise<void>;
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<WorkoutSession[]>('/workouts/');
      setSessions(data);
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

  const getSession = useCallback(
    (id: string) => sessions.find(s => s.id === id),
    [sessions],
  );

  return (
    <WorkoutsContext.Provider
      value={{ sessions, loading, error, addSession, deleteSession, getSession, refresh }}
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
