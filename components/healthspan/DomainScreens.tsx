import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { V2Colors as C } from '../../constants/v2Theme';
import { useTodayHealth } from '../../context/TodayHealthContext';
import { useHealth } from '../../context/HealthContext';
import { useWorkouts } from '../../context/WorkoutsContext';
import { compareCompleteDays, daysEnding, entryDay, goalFor, goalLabel, healthObservations, localDay, numberLabel, nutritionOnDay, progressFraction, shiftDay, trainingWeek, weightObservations } from '../../utils/healthspan';
import { PLANET_FITNESS_TEMPLATES, getSuggestedTemplateId } from '../../utils/workoutTemplates';
import { computeExerciseStats } from '../../utils/stats';
import { Body, Button, Card, Empty, Eyebrow, LinkRow, Notice, Screen, Stat, TrendTile, styles } from './UI';

// Focus refresh keeps data saved by Jarvis/other devices from looking current forever.
// The context APIs only read here. Form writes remain explicit user actions.
// Subscribe to the shared foreground/date rollover signal as well as domain data.
function useDomains() {
  useTodayHealth();
  const health = useHealth();
  const workouts = useWorkouts();
  useFocusEffect(useCallback(() => { void health.refresh(); void workouts.refresh(); }, [health.refresh, workouts.refresh]));
  return { health, workouts, today: localDay(), refresh: () => { void health.refresh(); void workouts.refresh(); } };
}
function HealthTiles({ compact = false }: { compact?: boolean }) {
  const { healthDailyEntries, bodyWeightEntries } = useHealth();
  const today = localDay();
  return <View style={styles.grid}>
    <TrendTile title="Resting heart rate" unit="bpm" window={compareCompleteDays(healthObservations(healthDailyEntries, 'restingHeartRateBpm'), today)} href="/trends?metric=recovery" />
    <TrendTile title="HRV" unit="ms" window={compareCompleteDays(healthObservations(healthDailyEntries, 'hrvMs'), today)} href="/trends?metric=recovery" />
    {!compact && <>
      <TrendTile title="Sleep duration" unit="min" duration window={compareCompleteDays(healthObservations(healthDailyEntries, 'sleepMinutes'), today)} href="/trends?metric=recovery" />
      <TrendTile title="Daily movement" unit="steps" window={compareCompleteDays(healthObservations(healthDailyEntries, 'steps'), today)} href="/trends?metric=recovery" />
      <TrendTile title="Body weight" unit="lb" window={compareCompleteDays(weightObservations(bodyWeightEntries), today)} href="/trends?metric=weight" />
      <TrendTile title="Body composition" unit="%" window={compareCompleteDays(weightObservations(bodyWeightEntries, 'bodyFatPercent'), today)} href="/trends?metric=weight" />
    </>}
  </View>;
}
export function HealthspanScreen() {
  const { health, workouts, today, refresh } = useDomains();
  const recentTraining = workouts.sessions.filter(session => entryDay(session.date) >= shiftDay(today, -7) && entryDay(session.date) < today);
  const loggedFoodDays = daysEnding(shiftDay(today, -1), 7).filter(day => nutritionOnDay(health.nutritionEntries, day).rows.length > 0).length;
  if (health.error && !health.dashboardSummary) return <Screen title="Healthspan" onRefresh={refresh} refreshing={health.loading}><Notice error={health.error} /><Empty title="Your data is unavailable" detail="Refresh to load saved health records. Missing records are not treated as zero." /></Screen>;
  return <Screen title="Healthspan" subtitle="The long view. Built one day at a time." onRefresh={refresh} refreshing={health.loading || workouts.loading} loading={health.loading && !health.dashboardSummary}>
    <Notice error={health.error || workouts.error} />
    <Card accent><Eyebrow>Direction, not a verdict</Eyebrow><Text style={styles.sectionTitle}>Build your healthspan</Text><Body>Watch your foundations together: recovery, sleep, movement, strength and nutrition. No invented biological age or all-in-one health score.</Body></Card>
    <View><Text style={styles.sectionTitle}>Your health, over time</Text><Text style={styles.caption}>7 complete days vs the preceding 28 · charts show 28 days</Text></View>
    <HealthTiles />
    <Card><Eyebrow>Consistency · last 7 complete days</Eyebrow><View style={styles.grid}><Stat label="Logged sessions" value={numberLabel(recentTraining.length)} /><Stat label="Food logged" value={`${loggedFoodDays}/7`} unit="days" /></View><Body muted>Logging coverage is not a measure of diet quality. A day without a logged workout can be an intentional rest day.</Body></Card>
    <Card><Eyebrow>Your targets</Eyebrow>{health.goals.filter(goal => goal.status === 'active').map(goal => <View key={goal.id} style={[styles.row, { alignItems: 'flex-start' }]}><Text style={[styles.body, styles.flex]}>{goal.title}</Text><Text style={[styles.body, { color: C.text, flex: 1, textAlign: 'right' }]}>{goalLabel(goal)}</Text></View>)}<LinkRow title="Manage targets & reviews" href="/health" /></Card>
    <Text style={styles.caption}>Wearable estimates and smart-scale composition need context. Source changes can affect trends. Blood pressure and lab results are not connected here and are not inferred.</Text>
  </Screen>;
}
export function TrainScreen() {
  const { health, workouts, today, refresh } = useDomains();
  const router = useRouter();
  const week = trainingWeek(workouts.sessions, today);
  const goal = goalFor(health.goals, 'workout_frequency');
  const template = PLANET_FITNESS_TEMPLATES.find(item => item.id === getSuggestedTemplateId(new Date().getDay()));
  const sessions = [...workouts.sessions].filter(session => entryDay(session.date) <= today).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const strength = computeExerciseStats(sessions).slice(0, 3);
  if (workouts.error && !sessions.length) return <Screen title="Train" onRefresh={refresh} refreshing={workouts.loading}><Notice error={workouts.error} /><Button title="Open workout logger" onPress={() => router.push('/workout')} /></Screen>;
  return <Screen title="Train" subtitle="Strength for life. Room to recover." onRefresh={refresh} refreshing={workouts.loading} loading={workouts.loading && !sessions.length}>
    <Notice error={workouts.error} />
    <Card accent><Eyebrow>Your training week · Mon–Sun</Eyebrow><View style={styles.grid}><Stat label="Sessions logged" value={numberLabel(week.rows.length)} detail={goalLabel(goal)} /><Stat label="Training time" value={numberLabel(week.minutes)} unit="min" /></View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>{week.days.map((day, i) => <View key={day.day} accessible accessibilityLabel={`${day.day}: ${day.future ? 'future' : `${day.count} sessions logged`}`} style={{ alignItems: 'center', gap: 8 }}><Text style={styles.caption}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</Text><View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: day.count ? C.primaryDim : C.background, borderWidth: 1, borderColor: day.day === today ? C.primary : C.divider, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: day.count ? C.primary : C.textMuted }}>{day.count ? '✓' : day.future ? '·' : '—'}</Text></View></View>)}</View>
      <Body muted>Rest is part of the plan. An empty date means no session is logged, not that you need to make one up.</Body>
    </Card>
    <Card><Eyebrow>Your saved weekly plan</Eyebrow><Text style={styles.sectionTitle}>{template ? template.title : 'No scheduled session today'}</Text><Body>{template ? `${template.focus} · approximately ${template.estimatedMinutes} min` : 'Open the logger to choose a session, or leave today as a rest day.'}</Body><Text style={styles.caption}>This is your calendar template, not a prescription based on the recovery score.</Text><Button title="Open workout logger" onPress={() => router.push('/workout')} /></Card>
    <View><Text style={styles.sectionTitle}>Recent sessions</Text><Text style={styles.caption}>Your lifting, cardio and feedback stay together.</Text></View>
    {sessions.length ? <Card>{sessions.slice(0, 3).map(session => <LinkRow key={session.id} title={session.templateId ? `${session.templateId[0].toUpperCase()}${session.templateId.slice(1)} session` : session.exercises[0]?.name ?? 'Workout'} subtitle={`${new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${numberLabel(session.durationMinutes)} min · ${session.exercises.length} exercises`} href={{ pathname: '/session/[id]', params: { id: session.id } }} />)}<LinkRow title="All workout history" href="/history" /></Card> : <Empty title="A fresh training log" detail="Your recorded sessions will appear here. Use the logger to add one." />}
    <Card><Eyebrow>Strength records</Eyebrow>{strength.map(stat => <View key={stat.name} style={{ gap: 4 }}><Text style={styles.linkTitle}>{stat.name}</Text><Body>{numberLabel(stat.bestSet.weight)} lb × {stat.bestSet.reps} reps · {stat.sessionCount} sessions logged</Body></View>)}{!strength.length && <Body>Recorded strength sets will appear here.</Body>}<LinkRow title="Explore strength progress" href="/stats" /></Card>
  </Screen>;
}
export function FuelScreen() {
  const { health, today, refresh } = useDomains();
  const router = useRouter();
  const { rows, totals } = nutritionOnDay(health.nutritionEntries, today);
  const calorieGoal = goalFor(health.goals, 'calories');
  const completedDays = daysEnding(shiftDay(today, -1), 7).map(day => ({ day, ...nutritionOnDay(health.nutritionEntries, day) }));
  const observed = completedDays.filter(day => day.rows.length > 0);
  if (health.error && !health.dashboardSummary) return <Screen title="Fuel" onRefresh={refresh} refreshing={health.loading}><Notice error={health.error} /><Empty title="Food records unavailable" detail="The saved log could not be loaded. No intake totals are inferred." /><Button title="Open food diary" onPress={() => router.push('/nutrition')} /></Screen>;
  return <Screen title="Fuel" subtitle="Nourish today. Support the long term." onRefresh={refresh} refreshing={health.loading} loading={health.loading && !health.dashboardSummary}>
    <Notice error={health.error} />
    <Card accent><Eyebrow>Today’s logged intake</Eyebrow><Stat label="Energy" value={numberLabel(totals.calories)} unit="kcal" detail={`Your target: ${goalLabel(calorieGoal)}`} /><Body muted>{rows.length ? `${rows.length} food entries · today's log may still be incomplete` : 'No food logged today. This does not mean you have eaten nothing.'}</Body><Button title="Open food diary" onPress={() => router.push('/nutrition')} /></Card>
    <View style={styles.grid}>{([['Protein', 'proteinG', 'protein'], ['Fiber', 'fiberG', 'fiber']] as const).map(([title, field, kind]) => {
      const goal = goalFor(health.goals, kind);
      const fraction = progressFraction(totals[field], goal);
      return <View key={field} style={styles.trendTile}><Stat label={title} value={numberLabel(totals[field], 1)} unit="g" /><Body>{goalLabel(goal)}</Body>{fraction != null && <View accessibilityLabel={`${title} progress against your saved target`} style={{ height: 5, borderRadius: 3, backgroundColor: C.divider, overflow: 'hidden' }}><View style={{ width: `${fraction * 100}%`, height: 5, backgroundColor: field === 'fiberG' ? C.secondary : C.primary }} /></View>}<Text style={styles.caption}>Based on logged entries</Text></View>;
    })}</View>
    <Card><Eyebrow>The rest of your macros</Eyebrow><View style={styles.grid}><Stat label="Carbohydrate" value={numberLabel(totals.carbsG, 1)} unit="g" /><Stat label="Fat" value={numberLabel(totals.fatG, 1)} unit="g" /></View></Card>
    <Card><Eyebrow>7 completed days · logging coverage</Eyebrow><Text style={styles.sectionTitle}>{observed.length}/7 days have food entries</Text><Body>Days without entries are not counted as zero-calorie days. Even logged days may be incomplete.</Body>{observed.length > 0 && <View style={styles.grid}><Stat label="Logged energy / day" value={numberLabel(observed.reduce((sum, day) => sum + day.totals.calories, 0) / observed.length)} unit="kcal" /><Stat label="Logged protein / day" value={numberLabel(observed.reduce((sum, day) => sum + day.totals.proteinG, 0) / observed.length)} unit="g" /></View>}<LinkRow title="Explore nutrition trends" href="/trends?metric=nutrition" /></Card>
    <Card><Eyebrow>Today’s food</Eyebrow>{rows.length ? rows.map(row => <View key={row.id} style={{ paddingVertical: 6, gap: 4 }}><Text style={styles.linkTitle}>{row.name}</Text><Body muted>{row.meal} · {numberLabel(row.calories)} kcal · {numberLabel(row.proteinG, 1)} g protein</Body></View>) : <Body>Your saved meals will appear here.</Body>}<LinkRow title="Add or edit your food log" href="/nutrition" /></Card>
  </Screen>;
}
export function ProgressScreen() {
  const { health, workouts, refresh } = useDomains();
  return <Screen title="Trends" subtitle="Look for patterns, not perfect days." onRefresh={refresh} refreshing={health.loading || workouts.loading} loading={health.loading && !health.dashboardSummary}>
    <Notice error={health.error || workouts.error} />
    <Card accent><Eyebrow>Your long view</Eyebrow><Text style={styles.sectionTitle}>Consistency becomes visible.</Text><Body>Compare complete days, inspect the observations and keep source changes in view. A trend is not proof of cause and effect.</Body></Card>
    <HealthTiles compact />
    <Card><LinkRow title="Recovery & activity" subtitle="Sleep, HRV, resting heart rate and movement" href="/trends?metric=recovery" /><LinkRow title="Body & composition" subtitle="Weight and available smart-scale measurements" href="/trends?metric=weight" /><LinkRow title="Nutrition" subtitle="Logged energy, protein and fiber over time" href="/trends?metric=nutrition" /><LinkRow title="Training" subtitle="Weekly volume, sessions and training time" href="/trends?metric=training" /></Card>
    <Card><Eyebrow>Weekly reflection</Eyebrow><Body>{health.weeklyReview ? `A saved review is available for ${health.weeklyReview.weekStart} through ${health.weeklyReview.weekEnd}.` : 'No saved weekly review is available for the latest completed period.'}</Body><LinkRow title="Open reviews & goals" href="/health" /></Card>
    <Text style={styles.caption}>Personal experiments and cross-domain correlations are not calculated in this version. The dashboard does not invent them from a few observations.</Text>
  </Screen>;
}
