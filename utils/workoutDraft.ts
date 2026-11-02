import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WORKOUT_DRAFT_KEY,
  WorkoutDraftFields,
  WorkoutDraftSnapshot,
  draftHasContent,
  parseWorkoutDraft,
  serializeWorkoutDraft,
} from './workoutDraftCodec';

export async function loadWorkoutDraft<E = unknown>(): Promise<WorkoutDraftSnapshot<E> | null> {
  try {
    return parseWorkoutDraft<E>(await AsyncStorage.getItem(WORKOUT_DRAFT_KEY));
  } catch {
    return null;
  }
}

export async function persistWorkoutDraft<E>(fields: WorkoutDraftFields<E>): Promise<void> {
  try {
    if (!draftHasContent(fields)) {
      await AsyncStorage.removeItem(WORKOUT_DRAFT_KEY);
      return;
    }
    await AsyncStorage.setItem(WORKOUT_DRAFT_KEY, serializeWorkoutDraft(fields));
  } catch {
    // Persistence is best-effort; never block logging.
  }
}

export async function clearWorkoutDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WORKOUT_DRAFT_KEY);
  } catch {
    // ignore
  }
}
