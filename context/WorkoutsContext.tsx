import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { WorkoutSession } from '../types/workout';
import { loadSessions, saveSessions, isSeeded, markSeeded } from '../utils/storage';
import { generateId } from '../utils/id';
import { MOCK_SESSIONS } from '../data/mockData';

interface WorkoutsContextValue {
  sessions: WorkoutSession[];
  loading: boolean;
  addSession: (data: Omit<WorkoutSession, 'id'>) => Promise<WorkoutSession>;
  deleteSession: (id: string) => Promise<void>;
  getSession: (id: string) => WorkoutSession | undefined;
  refresh: () => Promise<void>;
}

const WorkoutsContext = createContext<WorkoutsContextValue | undefined>(
  undefined,
);

function sortDesc(sessions: WorkoutSession[]): WorkoutSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function WorkoutsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const seeded = await isSeeded();
      if (!seeded) {
        await saveSessions(MOCK_SESSIONS);
        await markSeeded();
        setSessions(sortDesc(MOCK_SESSIONS));
      } else {
        const stored = await loadSessions();
        setSessions(sortDesc(stored));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addSession = useCallback(
    async (data: Omit<WorkoutSession, 'id'>): Promise<WorkoutSession> => {
      const session: WorkoutSession = { ...data, id: generateId() };
      setSessions(prev => {
        const next = sortDesc([session, ...prev]);
        saveSessions(next).catch(console.error);
        return next;
      });
      return session;
    },
    [],
  );

  const deleteSession = useCallback(async (id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSessions(next).catch(console.error);
      return next;
    });
  }, []);

  const getSession = useCallback(
    (id: string) => sessions.find(s => s.id === id),
    [sessions],
  );

  return (
    <WorkoutsContext.Provider
      value={{ sessions, loading, addSession, deleteSession, getSession, refresh }}
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
