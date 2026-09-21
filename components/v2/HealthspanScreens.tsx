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
export function HealthspanScreen() {
  const health = useHealth(); const router = useRouter();
  const date = useHealthspanRefresh(health.refresh);
  const latest = health.dashboardSummary?.latestWeight;
  return <Page title="Healthspan" subtitle="Your health, over time. Trends rather than a daily verdict." refreshing={health.loading} onRefresh={health.refresh} error={health.error}>
    <Card title="Build a stronger baseline" label="The long view"><Text style={s.body}>Sleep, movement, strength and nutrition belong in the same picture. Follow your own trends without turning every change into a warning.</Text><Text style={s.note}>These are observations, not a biological age or a validated longevity score.</Text></Card>
    <Text style={s.note}>Last 14 completed days · recent 7-day averages</Text>
    {metrics.map(metric => {
      const trend = metricTrend(health.healthDailyEntries, metric.field, date);
      return <Card key={metric.field} title={metric.name}><Text style={s.statValue}>{metric.field === 'sleepMinutes' ? duration(trend.recent) : `${numberLabel(trend.recent, metric.digits)} ${metric.unit}`}</Text><Sparkline points={trend.points} label={`${metric.name}, last 14 completed days. Gaps are missing observations.`} /><Text style={s.note}>{trendCaption(trend, metric.unit, metric.digits)}</Text><Action title="View history" onPress={() => router.push('/trends?metric=recovery' as Href)} /></Card>;
    })}
    <Card title="Body composition"><View style={s.grid}><Stat label="Latest weight" value={`${numberLabel(latest?.weightLbs, 1)} lb`} detail={latest ? entryDay(latest.date) ?? 'Date unavailable' : 'No measurement yet'} /><Stat label="Body fat estimate" value={`${numberLabel(latest?.bodyFatPercent, 1)}%`} detail="Smart-scale estimate" /></View><Text style={s.note}>A single body-composition reading is not the trend.</Text><Action title="Weight history" onPress={() => router.push('/trends?metric=weight' as Href)} icon="scale-outline" /></Card>
    <Card title="Your targets">{health.goals.filter(goal => goal.status === 'active').map(goal => <View key={goal.id} style={s.row}><Text style={s.body}>{goal.title}</Text><Text style={s.note}>{goalLabel(goal)}</Text></View>)}{!health.goals.some(goal => goal.status === 'active') && <Text style={s.note}>No active targets loaded.</Text>}<Action title="Manage goals & record weight" detail="Uses the existing entry forms" onPress={() => router.push('/(tabs)/health')} icon="options-outline" /></Card>
    <Text style={s.note}>Source changes pause comparisons. The existing health feed supplies row-level sources, not verified per-metric device provenance.</Text>
  </Page>;
}
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
export function FuelScreen() {
  const health = useHealth(); const router = useRouter();
  const date = useHealthspanRefresh(health.refresh);
  const totals = health.dashboardSummary?.todayNutrition;
  const goal = (kind: string) => health.goals.find(item => item.status === 'active' && item.kind === kind);
  const meals = health.nutritionEntries.filter(entry => entryDay(entry.date) === date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4);
  return <Page title="Fuel" subtitle="Nutrition for strength, recovery and the long run." refreshing={health.loading} onRefresh={health.refresh} error={health.error}>
    <Card title="Today's nutrition" label={date}><Text style={s.statValue}>{numberLabel(totals?.calories)} kcal</Text><Text style={s.note}>Target: {goalLabel(goal('calories'))}</Text><View style={s.grid}><Stat label="Protein" value={`${numberLabel(totals?.proteinG, 1)} g`} detail={goalLabel(goal('protein'))} /><Stat label="Fiber" value={`${numberLabel(totals?.fiberG, 1)} g`} detail={goalLabel(goal('fiber'))} /><Stat label="Carbohydrate" value={`${numberLabel(totals?.carbsG, 1)} g`} /><Stat label="Fat" value={`${numberLabel(totals?.fatG, 1)} g`} /></View><Text style={s.note}>Logged intake only. A partial food log is not proof of low intake, and missing meals are not zero-calorie meals.</Text><Action title="Log food & edit meals" icon="restaurant-outline" detail="Your existing food-entry workflow" onPress={() => router.push('/(tabs)/nutrition')} /></Card>
    <Card title="Recent food entries">{meals.length ? meals.map(meal => <View key={meal.id}><Text style={s.body}>{meal.name}</Text><Text style={s.note}>{meal.meal} · {numberLabel(meal.calories)} kcal · {numberLabel(meal.proteinG, 1)} g protein</Text></View>) : <Text style={s.note}>No food entries for today are loaded.</Text>}</Card>
    <Card title="Consistency over perfection"><Text style={s.body}>Use your calorie, protein and fiber targets as context, not a contest. GainLog will not silently change them based on a recovery score.</Text><Action title="Nutrition trends" icon="analytics-outline" onPress={() => router.push('/trends?metric=nutrition' as Href)} /><Action title="Manage targets" icon="options-outline" onPress={() => router.push('/(tabs)/health')} /></Card>
  </Page>;
}
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
