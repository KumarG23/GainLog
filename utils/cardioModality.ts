export function isTreadmill(name: string): boolean {
  return name.trim().toLowerCase() === 'treadmill';
}

export function cardioSwapChoices(name: string, kind: string): string[] {
  if (kind !== 'cardio') return [];
  if (isTreadmill(name)) return ['Elliptical'];
  return name.trim().toLowerCase() === 'elliptical' ? ['Treadmill'] : [];
}

interface CardioDraft {
  name: string;
  kind: string;
  resistanceLevel: string;
  inclinePercent: string;
}

// A correction keeps duration/distance but never converts machine settings.
export function swapCardioModality<T extends CardioDraft>(exercise: T, name: string): T {
  if (!cardioSwapChoices(exercise.name, exercise.kind).includes(name)) return exercise;
  return { ...exercise, name, resistanceLevel: '', inclinePercent: '' };
}
