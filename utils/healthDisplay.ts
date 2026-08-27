interface RecoveryCaloriesInput {
  totalCalories?: number | null;
  activeCalories?: number | null;
}

export interface RecoveryCaloriesDisplay {
  value: number;
  label: 'Total' | 'Active';
}

function validCalories(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function selectRecoveryCalories({
  totalCalories,
  activeCalories,
}: RecoveryCaloriesInput): RecoveryCaloriesDisplay | null {
  if (validCalories(totalCalories)) return { value: totalCalories, label: 'Total' };
  if (validCalories(activeCalories)) return { value: activeCalories, label: 'Active' };
  return null;
}

export function formatHealthUpdatedAt(value: string, timeZone?: string): string | null {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(timestamp);
    return `Updated ${formatted}`;
  } catch {
    return null;
  }
}
