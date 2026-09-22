import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { HealthV2Today } from '../../types/healthV2';
import type { SleepDetail } from '../../types/journey';
import { journeyRequest } from '../../context/JourneyContext';
import { daysBefore, duration, numberLabel, stateLabel } from '../../utils/healthspan';
import { buildSleepClockBasis, sleepTimingSpread } from '../../utils/dayJourney';
import { V2Colors as C } from '../../constants/v2Theme';
import { Sheet, Stat, s } from '../v2/ui';
import { Button, j, WeekBars } from './primitives';

export function MetricDetails({ kind, today, onClose, onPlan }: { kind: 'recovery' | 'sleep' | 'load'; today: HealthV2Today; onClose: () => void; onPlan: () => void }) {
  const [sleep, setSleep] = useState<SleepDetail | null>(null), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [retry, setRetry] = useState(0), [stageIndex, setStageIndex] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (kind !== 'sleep') return;
    const abort = new AbortController(); let active = true;
    const timer = setTimeout(() => abort.abort(), 12000);
    setLoading(true); setSleep(null); setError(null);
    journeyRequest<SleepDetail>(`/sleep/${today.date}`, {}, abort.signal).then(data => {
      if (data.date !== today.date || !Array.isArray(data.stages) || !Array.isArray(data.history)) throw new Error('Sleep detail is incomplete.');
      if (active) { setSleep(data); setStageIndex(0); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Sleep detail unavailable.'); }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [kind, today.date, retry]);
  const hrv = today.recovery.components.hrv, resting = today.recovery.components.restingHeartRate;
  const night = sleep?.night, span = night ? Date.parse(night.endUtc) - Date.parse(night.startUtc) : 0;
  const clock = night ? buildSleepClockBasis(night, sleep?.stages ?? []) : null;
  const timing = sleep ? sleepTimingSpread(sleep.history) : null;
  const stage = sleep?.stages[stageIndex];
  const colors: Record<string, string> = { DEEP: '#6674E8', REM: C.secondary, LIGHT: C.primary, CORE: C.primary, AWAKE: C.caution, ASLEEP: '#4E9CD9' };
  const goHistory = () => { onClose(); router.push(`/trends?metric=${kind === 'load' ? 'training' : 'recovery'}` as Href); };
  return <Sheet visible title={kind === 'sleep' ? 'Your night' : kind === 'load' ? 'Training load, in context' : 'Behind your recovery'} onClose={onClose}>
    <Text style={j.note}>{today.date} · GainLog estimate</Text>
    {kind === 'recovery' && <>
      <Text style={j.title}>{numberLabel(today.recovery.score)} <Text style={j.heading}>{stateLabel(today.recovery.state)}</Text></Text>
      <Text style={j.body}>Your own baseline is the reference—not another person’s score. Your check-in stays separate and can disagree.</Text>
      <Text style={j.heading}>Heart-rate variability</Text><View style={s.grid}><Stat label="Recorded" value={`${numberLabel(hrv?.valueMs, 1)} ms`} /><Stat label="Your baseline" value={`${numberLabel(hrv?.baselineMedianMs, 1)} ms`} /></View>
      <Text style={j.heading}>Resting heart rate</Text><View style={s.grid}><Stat label="Recorded" value={`${numberLabel(resting?.valueBpm)} bpm`} /><Stat label="Your baseline" value={`${numberLabel(resting?.baselineMedianBpm)} bpm`} /></View>
      <Text style={j.body}>Recorded sleep: {duration(today.sleep.components.duration?.valueMinutes)}. Missing inputs remain missing rather than turning into a poor score.</Text>
    </>}
    {kind === 'sleep' && <>
      <Text style={j.title}>{duration(night?.minutesAsleep ?? today.sleep.components.duration?.valueMinutes)}</Text><Text style={j.body}>Recorded sleep · {!night || !clock ? 'sleep timing not available' : `${clock.format(night.startUtc)} → ${clock.format(night.endUtc)} · ${clock.label}`}</Text>
      {loading && <ActivityIndicator color={C.primary} />}
      {error && <View style={j.error}><Text style={j.body}>{error}</Text><Button secondary title="Retry sleep detail" onPress={() => setRetry(v => v + 1)} /></View>}
      {sleep?.timelineStatus === 'available' && span > 0 && <>
        <View style={{ height: 120, backgroundColor: C.background, position: 'relative', overflow: 'hidden', borderRadius: 12 }} accessible accessibilityLabel="Sleep stage timeline. Use previous and next stage for exact times.">{sleep.stages.map((st, i) => <View key={`${st.startUtc}-${i}`} style={{ position: 'absolute', left: `${(Date.parse(st.startUtc) - Date.parse(night!.startUtc)) / span * 100}%`, width: `${(Date.parse(st.endUtc) - Date.parse(st.startUtc)) / span * 100}%`, top: st.type.toUpperCase() === 'AWAKE' ? 8 : st.type.toUpperCase() === 'REM' ? 34 : st.type.toUpperCase() === 'DEEP' ? 86 : 60, height: 22, backgroundColor: colors[st.type.toUpperCase()] ?? C.missing, opacity: i === stageIndex ? 1 : 0.6 }} />)}</View>
        <Text style={j.note}>Awake · REM · Light/Core · Deep. Gaps remain unobserved.</Text>
        {stage && clock && <Text style={j.body}>{stateLabel(stage.type.toLowerCase())} · {duration((Date.parse(stage.endUtc) - Date.parse(stage.startUtc)) / 60000)} · {clock.format(stage.startUtc)} · {clock.label}</Text>}
        <View style={j.row}><Button secondary title="Previous stage" disabled={stageIndex <= 0} onPress={() => setStageIndex(i => i - 1)} /><Button secondary title="Next stage" disabled={stageIndex >= sleep.stages.length - 1} onPress={() => setStageIndex(i => i + 1)} /></View>
      </>}
      {sleep && sleep.timelineStatus !== 'available' && <Text style={j.body}>{sleep.timelineStatus === 'invalid' ? 'Detailed stages overlap or have invalid timing, so the timeline is withheld.' : 'Detailed stages are not available for this night. No replacement timeline is generated.'}</Text>}
      {sleep && <><Text style={j.heading}>Your recent sleep rhythm</Text><WeekBars values={daysBefore(today.date, 7).map(date => sleep.history.find(n => n.date === date)?.minutesAsleep ?? null)} label="Available prior-night sleep duration" accent={C.secondary} /><Text style={j.body}>{timing === null ? 'More comparable nights with source-local timing are needed to describe bedtime variation.' : `Typical bedtime variation: ${timing} min from the central bedtime across ${sleep.history.length} prior nights.`}</Text><Text style={j.note}>Descriptive timing variation, not a sleep-health score. Selected session: {night?.provenance ?? 'unavailable'}.</Text></>}
      <Button title="Choose tonight’s sleep window" onPress={onPlan} />
    </>}
    {kind === 'load' && <>
      <Text style={j.title}>{numberLabel(today.load.loadPoints)} <Text style={j.heading}>points</Text></Text>
      <Text style={j.body}>{today.load.baseline ? `${today.load.baseline.ratio.toFixed(2)}× your recent active-day median, from ${today.load.baseline.activeDays} active days.` : 'A comparable active-day baseline is not ready yet.'}</Text>
      <View style={s.grid}><Stat label="Today’s load" value={numberLabel(today.load.loadPoints)} /><Stat label="Active-day median" value={numberLabel(today.load.baseline?.medianActiveDayPoints)} /></View>
      <Text style={j.heading}>What the wearable observed</Text><Text style={j.body}>Exercise duration: {duration(today.load.components.exerciseDuration?.minutes)}</Text>
      <Text style={j.body}>Load combines recorded exercise duration and eligible heart-rate-zone context. It does not measure muscular fatigue or replace your sets, reps, or reported effort.</Text>
      <Text style={j.note}>Low load is not a failure. A rest-day intention does not rewrite the wearable estimate.</Text>
    </>}
    <Button secondary title="Explore longer-term history" onPress={goHistory} />
    <Text style={j.note}>Experimental estimates, not diagnoses or training commands. Input coverage is not a probability of medical accuracy.</Text>
  </Sheet>;
}
