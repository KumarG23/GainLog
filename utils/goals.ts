export interface GoalTargetValues {
  targetValue?: number;
  minimumValue?: number;
  maximumValue?: number;
  unit?: string;
}

function withUnit(value: number, unit?: string) {
  return `${value}${unit ? ` ${unit}` : ''}`;
}

export function formatGoalTarget(goal: GoalTargetValues): string {
  const { minimumValue, targetValue, maximumValue, unit } = goal;
  if (minimumValue != null && maximumValue != null) {
    const range = `${minimumValue}–${maximumValue}${unit ? ` ${unit}` : ''}`;
    return targetValue != null ? `${range} · aim ${withUnit(targetValue, unit)}` : range;
  }
  if (targetValue != null) return withUnit(targetValue, unit);
  if (minimumValue != null) return `At least ${withUnit(minimumValue, unit)}`;
  if (maximumValue != null) return `Up to ${withUnit(maximumValue, unit)}`;
  return '';
}
