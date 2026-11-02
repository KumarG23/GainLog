// In-progress workout drafts live only in React state. Persisting them makes a
// process kill, reload, or relaunch (routine, OOM, update) non-destructive.

export const WORKOUT_DRAFT_KEY = '@gainlog:workout-draft:v1';
export const WORKOUT_DRAFT_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export interface WorkoutDraftSnapshot<E = unknown> {
  version: 1;
  savedAt: number;
  exercises: E[];
  strengthDuration: string;
  strengthHeartRate: string;
  strengthCalories: string;
  cardioHeartRate: string;
  cardioCalories: string;
  notes: string;
  effort: string | null;
  pain: boolean;
  selectedTemplateId: string | null;
}

export type WorkoutDraftFields<E = unknown> = Omit<WorkoutDraftSnapshot<E>, 'version' | 'savedAt'>;

export function draftHasContent(fields: WorkoutDraftFields): boolean {
  return fields.exercises.length > 0 || fields.notes.trim().length > 0;
}

export function serializeWorkoutDraft<E>(fields: WorkoutDraftFields<E>, now = Date.now()): string {
  return JSON.stringify({ version: 1, savedAt: now, ...fields });
}

export function parseWorkoutDraft<E = unknown>(
  raw: string | null,
  now = Date.now(),
): WorkoutDraftSnapshot<E> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkoutDraftSnapshot<E>>;
    if (!value || value.version !== 1 || typeof value.savedAt !== 'number') return null;
    if (now - value.savedAt > WORKOUT_DRAFT_MAX_AGE_MS || value.savedAt - now > 5 * 60 * 1000) return null;
    if (!Array.isArray(value.exercises)) return null;
    const text = (field: unknown) => (typeof field === 'string' ? field : '');
    const snapshot: WorkoutDraftSnapshot<E> = {
      version: 1,
      savedAt: value.savedAt,
      exercises: value.exercises,
      strengthDuration: text(value.strengthDuration),
      strengthHeartRate: text(value.strengthHeartRate),
      strengthCalories: text(value.strengthCalories),
      cardioHeartRate: text(value.cardioHeartRate),
      cardioCalories: text(value.cardioCalories),
      notes: text(value.notes),
      effort: typeof value.effort === 'string' ? value.effort : null,
      pain: value.pain === true,
      selectedTemplateId: typeof value.selectedTemplateId === 'string' ? value.selectedTemplateId : null,
    };
    return draftHasContent(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}
