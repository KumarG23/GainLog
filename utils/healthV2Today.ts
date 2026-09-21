interface TodayFocusInput {
  recoveryState: string;
  stressState: string;
}

type HealthV2Metric = 'recovery' | 'sleep' | 'load' | 'stress';
type HealthV2Tone = 'positive' | 'caution' | 'alert' | 'muted';

export function healthV2Tone(metric: HealthV2Metric, state: string): HealthV2Tone {
  if (state === 'unavailable' || state === 'warming_up' || state === 'observed') return 'muted';
  if (metric === 'stress') {
    if (state === 'high') return 'alert';
    if (state === 'moderate') return 'caution';
    return 'positive';
  }
  if (metric === 'load') {
    if (state === 'high') return 'caution';
    if (state === 'low') return 'muted';
    return 'positive';
  }
  if (state === 'high') return 'positive';
  if (state === 'moderate') return 'caution';
  return 'alert';
}

export function isHealthV2TodayEnabled(value = process.env.EXPO_PUBLIC_GAINLOG_V2_TODAY) {
  return value === '1';
}

export function formatDuration(minutes?: number | null) {
  if (minutes == null) return 'Unavailable';
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return `${hours}h ${remaining}m`;
}

export function formatConfidence(confidence: number) {
  if (confidence <= 0) return 'No confidence';
  if (confidence < 0.75) return 'Partial confidence';
  return 'High confidence';
}

export function buildTodayFocus({ recoveryState, stressState }: TodayFocusInput) {
  if (recoveryState === 'unavailable') {
    const baselineNote = stressState === 'warming_up'
      ? ' Physiological activation is still building a personal baseline.'
      : '';
    return `Recovery is unavailable because the required signals are incomplete.${baselineNote}`;
  }
  const opening = recoveryState === 'high'
    ? 'Recovery signals are strong this morning.'
    : recoveryState === 'moderate'
      ? 'Recovery signals are mixed this morning.'
      : 'Recovery signals are below your recent baseline this morning.';
  return `${opening} Physiological activation remains a retrospective view, not a readiness command.`;
}
