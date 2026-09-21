import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHealth } from '../../context/HealthContext';
import { useJourney } from '../../context/JourneyContext';
import { useHealthspanRefresh } from '../../hooks/useHealthspanRefresh';
import { dayKey, goalLabel, numberLabel } from '../../utils/healthspan';
import { foodFingerprint, foodOnDay, foodTotals, reviewedFood, targetProgress } from '../../utils/dayJourney';
import { Page } from '../v2/ui';
import { V2Colors as C } from '../../constants/v2Theme';
import { Button, j } from './primitives';
export function FuelOverview() {
  const health = useHealth(), journey = useJourney(), router = useRouter();
  useHealthspanRefresh(health.refresh);
  const [error, setError] = useState<string | null>(null);
  const date = dayKey(journey.now), meals = foodOnDay(health.nutritionEntries, date, journey.now), totals = foodTotals(meals);
  const reviewed = reviewedFood(journey.check, meals);
  const goal = (kind: string) => health.goals.find(g => g.status === 'active' && g.kind === kind);
  const review = async () => { try { await journey.saveDay(date, { nutritionReviewed: !reviewed, nutritionFingerprint: reviewed ? null : foodFingerprint(meals) }); } catch (e) { setError(e instanceof Error ? e.message : 'Review not saved.'); } };
  return <Page title="Fuel your day" subtitle="Your saved targets. Your actual entries." refreshing={health.loading} onRefresh={health.refresh} error={health.error}>
    <View style={j.hero}><Text style={j.eyebrow}>{date} · logged intake</Text><Text style={j.title}>{health.error || !meals.length ? '—' : numberLabel(totals.calories)} kcal</Text><Text style={j.body}>{meals.length ? `${meals.length} food entries · ${goalLabel(goal('calories'))}` : 'No entries loaded. That does not mean you have not eaten.'}</Text><Button title="Log or edit food" onPress={() => router.push('/(tabs)/nutrition' as Href)} /></View>
    {([{ key: 'protein', field: 'proteinG', title: 'Protein' }, { key: 'fiber', field: 'fiberG', title: 'Fiber' }] as const).map(metric => {
      const target = goal(metric.key), value = health.error || !meals.length ? null : totals[metric.field], progress = targetProgress(value, target);
      return <View key={metric.key} style={j.section}><View style={[j.row, { justifyContent: 'space-between' }]}><Text style={j.heading}>{metric.title}</Text><Text style={j.metricValue}>{numberLabel(value)} g</Text></View><Text style={j.body}>{goalLabel(target)}</Text><View style={{ height: 16, borderRadius: 8, backgroundColor: C.surface, overflow: 'hidden' }} accessible accessibilityLabel={`${metric.title}: ${numberLabel(value)} grams. ${goalLabel(target)}`}><View style={{ height: 16, width: `${progress.percent}%`, backgroundColor: metric.key === 'protein' ? C.primary : C.secondary }} />{progress.lowPercent !== null && <View style={{ position: 'absolute', left: `${progress.lowPercent}%`, top: 0, bottom: 0, width: 2, backgroundColor: C.text }} />}{progress.highPercent !== null && <View style={{ position: 'absolute', left: `${progress.highPercent}%`, top: 0, bottom: 0, width: 2, backgroundColor: C.text }} />}</View><Text style={j.note}>{progress.note} · markers show your saved target/range, not an instruction to eat</Text></View>;
    })}
    <View style={j.line} /><View style={j.section}><Text style={j.heading}>Check the log before drawing conclusions</Text><Text style={j.body}>{reviewed ? 'You marked today’s log reviewed. This is your confirmation, not independent proof of complete intake.' : 'Review the entries below. Mark them reviewed when they represent what you intend to log so far.'}</Text><Button secondary title={reviewed ? 'Mark log as needing review' : 'I reviewed today’s food log'} disabled={!journey.snapshot || !!journey.error || !!health.error || health.loading || journey.busy} onPress={() => void review()} />{(error || journey.error) && <Text style={j.note}>{error ?? journey.error}</Text>}</View>
    {[...meals].sort((a, b) => b.date.localeCompare(a.date)).map(meal => <View key={meal.id} style={{ gap: 5, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider }}><Text style={j.heading}>{meal.name}</Text><Text style={j.note}>{meal.meal} · {numberLabel(meal.calories)} kcal · {numberLabel(meal.proteinG)} g protein</Text></View>)}
    <Button secondary title="Look at longer-term nutrition" onPress={() => router.push('/trends?metric=nutrition' as Href)} /><Button secondary title="Manage my saved targets" onPress={() => router.push('/(tabs)/health' as Href)} />
  </Page>;
}
