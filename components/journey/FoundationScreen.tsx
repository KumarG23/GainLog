import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHealth } from '../../context/HealthContext';
import { useWorkouts } from '../../context/WorkoutsContext';
import { useJourney } from '../../context/JourneyContext';
import { useHealthspanRefresh } from '../../hooks/useHealthspanRefresh';
import { buildFoundations, FOCUS_LABELS } from '../../utils/dayJourney';
import { dayKey, daysBefore, metricTrend, numberLabel, trendCaption } from '../../utils/healthspan';
import type { Focus } from '../../types/journey';
import { Page, Sheet, Sparkline } from '../v2/ui';
import { V2Colors as C } from '../../constants/v2Theme';
import { Button, Choice, j, WeekBars } from './primitives';
import { CheckInSheet } from './CheckInSheet';
import type { DayCheckIn } from '../../types/journey';
const accents: Record<Focus, string> = { sleep: C.secondary, movement: '#4E9CD9', strength: C.primary, nutrition: '#E6C27A', stress: '#AC9ADE' };
export function FoundationScreen() {
  const health = useHealth(), workouts = useWorkouts(), journey = useJourney(), router = useRouter();
  const [focusOpen, setFocusOpen] = useState(false), [error, setError] = useState<string | null>(null), [selectedDay, setSelectedDay] = useState<DayCheckIn | null>(null);
  const healthRefresh = health.refresh, workoutRefresh = workouts.refresh, journeyRefresh = journey.refresh;
  const refresh = useCallback(async () => { await Promise.all([healthRefresh(), workoutRefresh(), journeyRefresh()]); }, [healthRefresh, workoutRefresh, journeyRefresh]);
  useHealthspanRefresh(refresh);
  const date = dayKey(journey.now), dates = daysBefore(date, 7);
  const foundations = buildFoundations(health.healthDailyEntries, workouts.sessions, health.nutritionEntries, journey.snapshot?.days ?? [], date);
  const weight = metricTrend(health.bodyWeightEntries, 'weightLbs', date);
  const reflections = [...(journey.snapshot?.days ?? [])].filter(d => d.reflection && d.date < date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const focus = journey.preferences.focus;
  const saveFocus = async (value: Focus | null) => { try { await journey.savePreferences({ focus: value }, journey.preferences.revision); setFocusOpen(false); } catch (e) { setError(e instanceof Error ? e.message : 'Focus not saved.'); } };
  return <Page title="Build your baseline" subtitle="A week of choices. A longer view of progress." refreshing={health.loading || workouts.loading || journey.loading} onRefresh={refresh} error={health.error ?? workouts.error}>
    <View style={[j.hero, { borderTopColor: C.secondary }]}><Text style={[j.eyebrow, { color: C.secondary }]}>Your weekly review · {dates[0]} – {dates[6]}</Text><Text style={j.title}>{focus ? `Make room for ${FOCUS_LABELS[focus].toLowerCase()}.` : 'Build one habit, not five perfect scores.'}</Text><Text style={j.body}>{focus ? 'This is the focus you chose. Review your recorded week below, then keep it or choose another.' : health.error || workouts.error ? 'Refresh your records to review the week; no missing record is treated as a setback.' : `${foundations[1].value} logged across ${foundations[1].observed} days. Food entries on ${foundations[3].observed}/7 days. Average recorded sleep: ${foundations[0].value}. Choose one foundation to pay attention to next.`}</Text><Button title={focus ? 'Review my weekly focus' : 'Choose my weekly focus'} onPress={() => { setError(null); setFocusOpen(true); }} /></View>
    <Text style={j.note}>Seven completed local days. Behaviors and observations stay separate; no biological-age or healthspan score.</Text>
    {foundations.map(foundation => {
      const unavailable = foundation.id === 'strength' ? !!workouts.error : foundation.id === 'stress' ? !!journey.error : !!health.error;
      return <View key={foundation.id} style={{ gap: 12, borderLeftWidth: 3, borderLeftColor: accents[foundation.id], paddingLeft: 18, paddingVertical: 12 }}><View style={[j.row, { justifyContent: 'space-between' }]}><Text style={j.heading}>{foundation.title}</Text>{focus === foundation.id && <Text style={[j.eyebrow, { color: accents[foundation.id] }]}>Your focus</Text>}</View><Text style={j.title}>{unavailable ? 'Refresh needed' : foundation.value}</Text><Text style={j.body}>{foundation.detail}</Text>{!unavailable && <WeekBars values={foundation.days} binary={foundation.id === 'strength' || foundation.id === 'nutrition'} label={foundation.title} accent={accents[foundation.id]} />}<Text style={j.note}>{dates[0].slice(5)} → {dates[6].slice(5)} · {unavailable ? 'Could not refresh this source' : `${foundation.observed}/7 days with ${foundation.id === 'strength' || foundation.id === 'nutrition' ? 'logs' : 'observations'}`}</Text><Button secondary title={foundation.id === 'stress' ? 'Open today’s context' : 'Explore this foundation'} onPress={() => router.push(foundation.href as Href)} /></View>;
    })}
    <View style={j.line} />
    <View style={j.section}><Text style={j.eyebrow}>An observation, not a daily verdict</Text><Text style={j.heading}>Body-weight direction</Text><Text style={j.title}>{health.error ? '—' : numberLabel(weight.recent, 1)} lb</Text><Text style={j.body}>Recent seven-day average</Text>{!health.error && <Sparkline points={weight.points} label="Fourteen completed days of weight; missing days remain gaps" />}<Text style={j.note}>{trendCaption(weight, 'lb')}</Text><Button secondary title="Investigate weight & body composition" onPress={() => router.push('/trends?metric=weight' as Href)} /></View>
    <View style={j.section}><Text style={j.heading}>What you wanted to remember</Text>{reflections.length ? reflections.map(day => <View key={day.date} style={{ gap: 8, paddingVertical: 8 }}><Text style={j.eyebrow}>{day.date}</Text><Text style={j.body}>{day.reflection}</Text><Button secondary title={`Review or clear ${day.date}`} onPress={() => setSelectedDay(day)} /></View>) : <Text style={j.body}>Evening reflections will live here, beside your recorded week—not inside an unexplained score.</Text>}</View>
    <Sheet visible={focusOpen} title="One focus for this week" onClose={() => { if (!journey.busy) setFocusOpen(false); }}><Text style={j.body}>Choose the area you want to pay attention to. This does not modify any saved goal, workout, or calorie target.</Text>{(Object.keys(FOCUS_LABELS) as Focus[]).map(key => <Choice key={key} label={FOCUS_LABELS[key]} selected={focus === key} disabled={!journey.snapshot || journey.busy || !!journey.error} onPress={() => void saveFocus(key)} />)}{focus && <Button secondary title="Clear my focus" disabled={journey.busy || !!journey.error} onPress={() => void saveFocus(null)} />}{(error || journey.error) && <Text style={j.body}>{error ?? journey.error}</Text>}</Sheet>
    {selectedDay && <CheckInSheet initial={selectedDay} mode="reflection" onClose={() => setSelectedDay(null)} />}
  </Page>;
}
