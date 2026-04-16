import AsyncStorage from '@react-native-async-storage/async-storage';
import { WorkoutSession } from '../types/workout';

const SESSIONS_KEY = '@gainlog:sessions';
const SEEDED_KEY = '@gainlog:seeded';

export async function loadSessions(): Promise<WorkoutSession[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as WorkoutSession[]) : [];
  } catch {
    return [];
  }
}

export async function saveSessions(sessions: WorkoutSession[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function isSeeded(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SEEDED_KEY);
  return raw === 'true';
}

export async function markSeeded(): Promise<void> {
  await AsyncStorage.setItem(SEEDED_KEY, 'true');
}
