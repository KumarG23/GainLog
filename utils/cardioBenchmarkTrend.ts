import type { WorkoutSession } from '../types/workout';

/** Only verified, sufficiently covered, explicitly timed protocol sessions. */
export function benchmarkTrend(sessions: readonly WorkoutSession[]) {
  const byDate = new Map<string, { date: string; value: number; details: { label: string; value: string }[] }>();
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const analysis = session.cardioAnalysis;
    const hr = analysis?.benchmarkAverageHr;
    if (analysis?.windowSource !== 'recorded' || !analysis.protocolCompliant ||
        analysis.benchmarkCoverage == null || analysis.benchmarkCoverage < 0.8 ||
        hr == null || !Number.isFinite(hr)) continue;
    // Preserve the clock date the athlete recorded, including its original UTC offset.
    const date = (session.exercises.find(ex => ex.kind === 'cardio')?.cardioStartedAt ??
      analysis.segments[0]?.start ?? session.date).slice(0, 10);
    byDate.set(date, { date, value: hr, details: [
      { label: 'Protocol', value: '3 mph · 7% · 20 min' },
      { label: 'Minutes 10–20', value: `${hr} bpm average` },
      { label: 'HR coverage', value: `${Math.round(analysis.benchmarkCoverage * 100)}%` },
    ] });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
