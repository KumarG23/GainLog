import { WorkoutSession, WorkoutSet } from '../types/workout';

export interface ExerciseStats {
  name: string;
  totalVolume: number;
  bestSet: WorkoutSet;
  sessionCount: number;
  totalSets: number;
  totalReps: number;
}

export function computeExerciseStats(sessions: WorkoutSession[]): ExerciseStats[] {
  const displayName = new Map<string, string>();
  const totalVolume = new Map<string, number>();
  const bestSet = new Map<string, WorkoutSet>();
  const sessionIds = new Map<string, Set<string>>();
  const totalSets = new Map<string, number>();
  const totalReps = new Map<string, number>();

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const raw = exercise.name.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();

      if (!displayName.has(key)) {
        displayName.set(key, raw);
        totalVolume.set(key, 0);
        bestSet.set(key, { id: '', weight: 0, reps: 0 });
        sessionIds.set(key, new Set());
        totalSets.set(key, 0);
        totalReps.set(key, 0);
      }

      const sids = sessionIds.get(key)!;
      if (!sids.has(session.id)) sids.add(session.id);

      for (const set of exercise.sets) {
        totalVolume.set(key, totalVolume.get(key)! + set.weight * set.reps);
        totalSets.set(key, totalSets.get(key)! + 1);
        totalReps.set(key, totalReps.get(key)! + set.reps);

        const cur = bestSet.get(key)!;
        if (
          set.weight > cur.weight ||
          (set.weight === cur.weight && set.reps > cur.reps)
        ) {
          bestSet.set(key, set);
        }
      }
    }
  }

  return Array.from(displayName.keys())
    .map(key => ({
      name: displayName.get(key)!,
      totalVolume: totalVolume.get(key)!,
      bestSet: bestSet.get(key)!,
      sessionCount: sessionIds.get(key)!.size,
      totalSets: totalSets.get(key)!,
      totalReps: totalReps.get(key)!,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

export function formatVolume(lbs: number): string {
  if (lbs >= 10000) return `${(lbs / 1000).toFixed(1)}k`;
  return `${lbs.toLocaleString()} lbs`;
}
