import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHealth } from '../../context/HealthContext';
import { useWorkouts } from '../../context/WorkoutsContext';
import { useJourney } from '../../context/JourneyContext';
import { useTodayHealth } from '../../hooks/useTodayHealth';
import { useHealthspanRefresh } from '../../hooks/useHealthspanRefresh';
import { buildDailyBrief, emptyDay, foodOnDay, foodTotals, sessionsOnDay, sleepPlan, type BriefAction } from '../../utils/dayJourney';
import { dayKey, duration, numberLabel } from '../../utils/healthspan';
import { getSuggestedTemplateId, PLANET_FITNESS_TEMPLATES } from '../../utils/workoutTemplates';
import { V2Colors as C } from '../../constants/v2Theme';
import { Page, Sheet } from '../v2/ui';
import { Button, j } from './primitives';
import { CheckInSheet } from './CheckInSheet';
import { SleepPlanSheet } from './SleepPlanSheet';
import { MetricDetails } from './MetricDetails';
import { DayStress } from './DayStress';

type Panel = 'checkin' | 'reflection' | 'sleep-plan' | 'training' | 'about' | null;
export function DailyExperience() {
  const health = useHealth(), workouts = useWorkouts(), journey = useJourney(), feed = useTodayHealth(), router = useRouter();
  const [panel, setPanel] = useState<Panel>(null), [metric, setMetric] = useState<'recovery' | 'sleep' | 'load' | null>(null);
  const [noteMinute, setNoteMinute] = useState<number | undefined>(undefined), [saveError, setSaveError] = useState<string | null>(null);
  const healthRefresh = health.refresh, workoutRefresh = workouts.refresh, journeyRefresh = journey.refresh, feedRefresh = feed.refresh;
  const refresh = useCallback(async () => { await Promise.all([healthRefresh(), workoutRefresh(), journeyRefresh()]); }, [healthRefresh, workoutRefresh, journeyRefresh]);
  useHealthspanRefresh(refresh);
  const allRefresh = useCallback(async () => { await Promise.all([refresh(), feedRefresh()]); }, [refresh, feedRefresh]);
  const date = dayKey(journey.now);
  const current = feed.today?.date === date ? feed.today : null;
  const template = PLANET_FITNESS_TEMPLATES.find(t => t.id === getSuggestedTemplateId(journey.now.getDay()));
  const brief = buildDailyBrief({ now: journey.now, today: current, modelStale: !!feed.error, healthStale: !!health.nutritionError, workoutsStale: !!workouts.error || workouts.loading, journeyStale: !!journey.error, sessions: workouts.sessions, meals: health.nutritionEntries, check: journey.error ? emptyDay(date) : journey.check, preferences: journey.preferences, planTitle: template?.title ?? null });
  const sessions = sessionsOnDay(workouts.sessions, journey.now), meals = foodOnDay(health.nutritionEntries, date, journey.now), totals = foodTotals(meals);
  const plan = sleepPlan(journey.preferences);
  const act = (action: BriefAction) => {
    if (action === 'fuel') router.push('/(tabs)/fuel' as Href);
    else setPanel(action === 'sleep' ? 'sleep-plan' : action);
  };
  const saveIntent = async (trainingIntent: 'plan' | 'rest') => { try { await journey.saveDay(date, { trainingIntent }, journey.check.revision); setPanel(null); } catch (e) { setSaveError(e instanceof Error ? e.message : 'Not saved.'); } };
  return <Page title="Today" refreshing={health.loading || workouts.loading || feed.refreshing || journey.loading} onRefresh={allRefresh} error={feed.error ?? health.error ?? workouts.error}>
    <View style={[j.row, { justifyContent: 'space-between' }]}><Text style={j.eyebrow}>{journey.now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text><Pressable accessibilityRole="button" accessibilityLabel="About estimates and data freshness" onPress={() => setPanel('about')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={j.note}>About your data ⓘ</Text></Pressable></View>
    <View style={j.hero}>
      <Text style={j.eyebrow}>{brief.phase} brief</Text><Text style={j.title}>{brief.title}</Text><Text style={j.body}>{brief.body}</Text>
      <Button title={brief.actionLabel} onPress={() => act(brief.action)} />
      {!!brief.evidence.length && <Text style={j.note}>{brief.evidence.join(' · ')}</Text>}
    </View>
    <View style={[j.row, { alignItems: 'stretch', paddingVertical: 8 }]}>
      {(['recovery', 'sleep', 'load'] as const).map(kind => <Pressable key={kind} style={j.metric} accessibilityRole="button" accessibilityLabel={`Explore ${kind}`} disabled={!current} onPress={() => setMetric(kind)}><Text style={j.note}>{kind === 'load' ? 'Training load' : kind === 'sleep' ? 'Sleep' : 'Recovery'}</Text><Text style={j.metricValue}>{kind === 'sleep' ? duration(current?.sleep.components.duration?.valueMinutes) : numberLabel(kind === 'recovery' ? current?.recovery.score : current?.load.loadPoints)}</Text><Text style={j.note}>{kind === 'sleep' ? 'Recorded duration' : kind === 'load' ? 'Wearable points' : current ? `${current.recovery.state.replaceAll('_', ' ')} · estimate` : 'Awaiting signals'} ›</Text></Pressable>)}
    </View>
    <View style={j.line} />
    <View style={j.section}><Text style={j.heading}>Your part of the picture</Text><Text style={j.body}>{journey.check.energy === null && journey.check.soreness === null && journey.check.stress === null ? 'A sensor can’t tell us how your day feels.' : [journey.check.energy !== null ? `Energy ${journey.check.energy}/5` : '', journey.check.soreness !== null ? `Soreness ${journey.check.soreness}/5` : '', journey.check.stress !== null ? `Perceived stress ${journey.check.stress}/5` : ''].filter(Boolean).join(' · ')}</Text>
      <Button secondary title={journey.check.revision ? 'Update my check-in' : 'Check in · optional'} onPress={() => { setNoteMinute(undefined); setPanel('checkin'); }} />
      {!!journey.error && <Text style={j.note} accessibilityLiveRegion="polite">{journey.error}</Text>}
    </View>
    <View style={j.line} />
    <View style={j.section}><Text style={j.heading}>{sessions.length && !workouts.error ? 'Training, acknowledged' : 'Today’s intention'}</Text><Text style={j.body}>{workouts.error ? 'Your training record could not be refreshed.' : sessions.length ? `${sessions.length} session${sessions.length > 1 ? 's' : ''} · ${duration(sessions.reduce((n, session) => n + session.durationMinutes, 0))} recorded. You don’t need another session to complete this screen.` : journey.check.trainingIntent === 'rest' ? 'Rest day selected. Your existing plan is unchanged.' : template ? `${template.title} · ${template.focus} · about ${template.estimatedMinutes} min in your existing plan.` : 'No scheduled template today. Choose your own intention.'}</Text><Button secondary title={sessions.length ? 'Open training' : 'Review plan or choose rest'} onPress={() => sessions.length ? router.push('/(tabs)/train' as Href) : setPanel('training')} /></View>
    <View style={j.section}><Text style={j.heading}>Fuel for the rest of your day</Text><Text style={j.body}>{health.nutritionError ? 'Nutrition could not be refreshed.' : meals.length ? `${numberLabel(totals.calories)} kcal · ${numberLabel(totals.proteinG)} g protein · ${numberLabel(totals.fiberG)} g fiber logged.` : 'No food entries loaded for today. That is not the same as not eating.'}</Text><Button secondary title="Review food & saved targets" onPress={() => router.push('/(tabs)/fuel' as Href)} /></View>
    {current && <DayStress key={date} data={current.stress} onNote={minute => { setNoteMinute(minute); setPanel('checkin'); }} />}
    <View style={[j.hero, { borderTopColor: C.secondary, marginTop: 8 }]}><Text style={[j.eyebrow, { color: C.secondary }]}>Tonight, on purpose</Text><Text style={j.heading}>{plan ? `${plan.bedtime} → ${plan.wake}` : 'Give tomorrow a starting point.'}</Text><Text style={j.body}>{plan ? `Wind down ${plan.windDown}. ${plan.opportunity} of time in bed, chosen by you—not an algorithm.` : 'Choose your wake time and planned time in bed. No invented sleep need or automatic alarm.'}</Text><Button secondary title={plan ? 'Adjust my sleep plan' : 'Plan tonight'} onPress={() => setPanel('sleep-plan')} />{journey.now.getHours() >= 18 && <Button secondary title={journey.check.reflection ? 'Read or edit my reflection' : 'Leave an evening reflection'} onPress={() => setPanel('reflection')} />}</View>
    <Text style={j.note}>Your choices stay yours. The brief never changes workouts, goals, or wearable scores.</Text>
    {(panel === 'checkin' || panel === 'reflection') && <CheckInSheet initial={journey.check} mode={panel} stressMinute={noteMinute} onClose={() => setPanel(null)} />}
    {panel === 'sleep-plan' && <SleepPlanSheet onClose={() => setPanel(null)} />}
    {current && metric && <MetricDetails kind={metric} today={current} onClose={() => setMetric(null)} onPlan={() => { setMetric(null); setPanel('sleep-plan'); }} />}
    <Sheet visible={panel === 'training'} title="Today’s plan, your decision" onClose={() => { if (!journey.busy) setPanel(null); }}><Text style={j.title}>{template?.title ?? 'An open day'}</Text><Text style={j.body}>{template?.focus ?? 'There is no scheduled template for this day.'}</Text><Text style={j.body}>Check-in: {journey.check.soreness === null ? 'soreness not recorded' : `soreness ${journey.check.soreness}/5`}. Recovery estimate: {numberLabel(current?.recovery.score)}. Neither automatically changes your training.</Text>{saveError && <Text style={j.body}>{saveError}</Text>}<Button title="Open the existing workout plan" disabled={journey.busy} onPress={() => { setPanel(null); router.push('/workout' as Href); }} /><Button secondary title="Save rest-day intention" onPress={() => void saveIntent('rest')} disabled={!journey.snapshot || journey.busy || !!journey.error} /><Button secondary title="Save plan-review intention" onPress={() => void saveIntent('plan')} disabled={!journey.snapshot || journey.busy || !!journey.error} /></Sheet>
    <Sheet visible={panel === 'about'} title="About your data" onClose={() => setPanel(null)}><Text style={j.body}>GainLog estimates are not Fitbit or WHOOP scores. They describe available inputs, not medical certainty or instructions to train.</Text><Text style={j.body}>The brief connects your saved records and check-in with explicit rules. It does not send health data to an AI model.</Text><Text style={j.body}>Physiological activation is retrospective and is not emotional stress. Missing periods stay unscored.</Text><Text style={j.note}>Model {current?.version ?? 'unavailable'} · response checked {feed.checkedAt?.toLocaleTimeString() ?? 'not yet'}. This is not the wearable’s last sync time. The existing physiology pipeline uses America/New_York; plans and check-ins use your device’s local day.</Text></Sheet>
  </Page>;
}
