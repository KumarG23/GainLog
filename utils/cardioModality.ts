export function isTreadmill(name: string): boolean {
  return name.trim().toLowerCase() === 'treadmill' || name.trim().toLowerCase().startsWith('treadmill · ');
}

export const SWAPPABLE_CARDIO = ['Elliptical', 'Treadmill', 'Stair Climber'] as const;

// Stair Climber uses resistanceLevel (machine level); it is cardio, never converted to steps.
export function cardioSwapChoices(name: string, kind: string): string[] {
  if (kind !== 'cardio') return [];
  const current = name.trim().toLowerCase();
  if (!SWAPPABLE_CARDIO.some(machine => machine.toLowerCase() === current)) return [];
  return SWAPPABLE_CARDIO.filter(machine => machine.toLowerCase() !== current);
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
