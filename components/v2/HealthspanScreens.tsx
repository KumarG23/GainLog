import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHealth } from '../../context/HealthContext';
import { useWorkouts } from '../../context/WorkoutsContext';
import { useHealthspanRefresh } from '../../hooks/useHealthspanRefresh';
import { calendarWeekSessions, duration, entryDay, finite, goalLabel, metricTrend, numberLabel, trendCaption } from '../../utils/healthspan';
import { Action, Card, Page, Sparkline, Stat, s } from './ui';

const metrics = [
  { field: 'hrvMs', name: 'HRV', unit: 'ms', digits: 1 },
  { field: 'restingHeartRateBpm', name: 'Resting heart rate', unit: 'bpm', digits: 0 },
  { field: 'sleepMinutes', name: 'Sleep duration', unit: 'min', digits: 0 },
  { field: 'steps', name: 'Daily movement', unit: 'steps', digits: 0 },
] as const;
export { FoundationScreen as HealthspanScreen } from '../journey/FoundationScreen';

export function TrainScreen() {
  const workouts = useWorkouts(); const health = useHealth(); const router = useRouter();
  const workoutsRefresh = workouts.refresh; const healthRefresh = health.refresh;
  const refresh = useCallback(async () => { await Promise.all([workoutsRefresh(), healthRefresh()]); }, [workoutsRefresh, healthRefresh]);
  useHealthspanRefresh(refresh);
  const week = calendarWeekSessions(workouts.sessions);
  const goal = health.goals.find(item => item.status === 'active' && item.kind === 'workout_frequency');
  const recent = [...workouts.sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3);
  const unavailable = workouts.loading && !workouts.sessions.length || !!workouts.error && !workouts.sessions.length;
  return <Page title="Train" subtitle="Build strength. Keep moving. Make room to recover." refreshing={workouts.loading || health.loading} onRefresh={refresh} error={workouts.error ?? health.error}>
    <Card title="This week" label="Monday to today"><View style={s.grid}><Stat label="Logged sessions" value={unavailable ? '—' : `${week.length}`} detail={goalLabel(goal)} /><Stat label="Recorded training" value={unavailable ? '—' : duration(week.reduce((total, session) => total + (finite(session.durationMinutes) ? session.durationMinutes : 0), 0))} detail="Logged sessions only" /></View><Action title="Log a workout" detail="Templates, lifting sets and cardio" icon="add-circle-outline" onPress={() => router.push('/workout' as Href)} /></Card>
    <Card title="Recent sessions">{recent.length ? recent.map(session => <Action key={session.id} title={session.templateId ? `${session.templateId.charAt(0).toUpperCase()}${session.templateId.slice(1)}` : 'Workout'} detail={`${entryDay(session.date) ?? 'Date unavailable'} · ${duration(session.durationMinutes)} · ${session.exercises.length} exercises`} icon="barbell-outline" onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })} />) : <Text style={s.note}>{unavailable ? 'Sessions unavailable.' : 'No sessions logged yet. Rest days do not count as failures.'}</Text>}<Action title="All workout history" onPress={() => router.push('/(tabs)/history')} icon="time-outline" /></Card>
    <Card title="Progress that matters"><Action title="Strength & workout stats" detail="Exercise progression and personal records" icon="trending-up-outline" onPress={() => router.push('/(tabs)/stats')} /><Action title="Training trends" detail="Your recorded training over time" icon="analytics-outline" onPress={() => router.push('/trends?metric=training' as Href)} /><Text style={s.note}>Keep logged strength work separate from wearable-derived load. They describe different parts of training.</Text></Card>
  </Page>;
}
export { FuelOverview as FuelScreen } from '../journey/FuelOverview';

export function TrendsScreen() {
  const health = useHealth(); const router = useRouter(); const date = useHealthspanRefresh(health.refresh);
  const weight = metricTrend(health.bodyWeightEntries, 'weightLbs', date);
  return <Page title="Trends" subtitle="Zoom out. See what is changing, and what is still uncertain." refreshing={health.loading} onRefresh={health.refresh} error={health.error}>
    <Card title="Your recent direction" label="7 days vs the previous 7">{metrics.map(metric => { const trend = metricTrend(health.healthDailyEntries, metric.field, date); return <View key={metric.field}><Text style={s.body}>{metric.name}</Text><Text style={s.note}>{trendCaption(trend, metric.unit, metric.digits)}</Text></View>; })}<Text style={s.note}>Comparisons require at least four observed days in each window and one consistent row-level source. They are descriptive changes, not causal findings.</Text></Card>
    <Card title="Weight trend"><Text style={s.statValue}>{numberLabel(weight.recent, 1)} lb</Text><Text style={s.note}>Recent 7-day average · {weight.recentDays} observed days</Text><Sparkline points={weight.points} label="Weight over the last 14 completed days; missing days are gaps." /><Text style={s.note}>{trendCaption(weight, 'lb')}</Text></Card>
    <Card title="Explore your history"><Action title="Recovery & activity" detail="Sleep, HRV, resting heart rate and movement" icon="heart-outline" onPress={() => router.push('/trends?metric=recovery' as Href)} /><Action title="Weight & body composition" icon="scale-outline" onPress={() => router.push('/trends?metric=weight' as Href)} /><Action title="Training" icon="barbell-outline" onPress={() => router.push('/trends?metric=training' as Href)} /><Action title="Nutrition" icon="restaurant-outline" onPress={() => router.push('/trends?metric=nutrition' as Href)} /></Card>
    <Text style={s.note}>Personal experiments and cross-domain correlations are a later phase. No causal explanations or biological-age estimates are invented here.</Text>
  </Page>;
}
