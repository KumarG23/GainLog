import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useRouter, type Href } from 'expo-router';
import { V2Colors as C } from '../constants/v2Theme';
import { useHealth } from '../context/HealthContext';
import { useTodayHealth } from '../hooks/useTodayHealth';
import { useHealthspanRefresh } from '../hooks/useHealthspanRefresh';
import { confidenceLabel, duration, finite, greeting, numberLabel, stateLabel, todayInterpretation } from '../utils/healthspan';
import { healthV2Tone } from '../utils/healthV2Today';
import { Action, Card, Page, Sheet, Stat, s } from './v2/ui';
import { StressTimeline } from './v2/StressTimeline';

function tone(metric: 'recovery' | 'sleep' | 'load', state: string) {
  return ({ positive: C.positive, caution: C.caution, alert: C.alert, muted: C.textSecondary })[healthV2Tone(metric, state)];
}
function RecoveryHero({ score, state }: { score: number | null; state: string }) {
  const value = finite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return <View style={t.arc} accessible accessibilityLabel={`Experimental recovery estimate: ${numberLabel(score)}. ${stateLabel(state)}.`}>
    <Svg width={240} height={135} viewBox="0 0 240 135"><Path d="M 25 120 A 95 95 0 0 1 215 120" fill="none" stroke={C.divider} strokeWidth={11} strokeLinecap="round" />{value > 0 && <Path d="M 25 120 A 95 95 0 0 1 215 120" fill="none" stroke={tone('recovery', state)} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${Math.PI * 95 * value / 100} ${Math.PI * 95}`} />}</Svg>
    <View style={t.arcText}><Text style={t.score}>{numberLabel(score)}</Text><Text style={[s.eyebrow, { color: tone('recovery', state) }]}>{stateLabel(state)}</Text></View>
  </View>;
}
export function TodayV2() {
  const feed = useTodayHealth(); const health = useHealth(); const router = useRouter();
  useHealthspanRefresh(health.refresh);
  const [detail, setDetail] = useState<'recovery' | 'sleep' | 'load' | null>(null);
  const feedRefresh = feed.refresh; const healthRefresh = health.refresh;
  const refresh = useCallback(async () => { await Promise.all([feedRefresh(), healthRefresh()]); }, [feedRefresh, healthRefresh]);
  const today = feed.today;
  const sleepMinutes = today?.sleep.components.duration?.valueMinutes;
  const hrv = today?.recovery.components.hrv;
  const resting = today?.recovery.components.restingHeartRate;
  const daily = health.dashboardSummary?.todayHealth;
  const currentDaily = today && daily?.date === today.date ? daily : null;
  const selected = today && detail ? today[detail] : null;
  return <Page title={greeting()} subtitle="Your day, explained by your own signals." refreshing={feed.refreshing || health.loading} onRefresh={refresh} error={feed.error ?? health.error} loading={!today && feed.refreshing}>
    {!today ? <Card title="Waiting for today's signals"><Text style={s.body}>No recovery estimate is displayed until the required data is available.</Text><Action title="Retry" icon="refresh-outline" onPress={() => void refresh()} /></Card> : <>
      <Card title="Recovery" label="Experimental personal baseline"><RecoveryHero score={today.recovery.score} state={today.recovery.state} /><View style={s.grid}><Stat label="HRV vs baseline" value={finite(hrv?.deviationPercent) ? `${hrv.deviationPercent >= 0 ? '+' : ''}${numberLabel(hrv.deviationPercent, 1)}%` : '—'} /><Stat label="Resting heart rate" value={`${numberLabel(resting?.valueBpm)} bpm`} /></View><Text style={s.note}>Model confidence: {confidenceLabel(today.recovery.confidence)} · {today.date}</Text><Action title="What is behind this estimate?" onPress={() => setDetail('recovery')} icon="information-circle-outline" /></Card>
      <View style={s.grid}>
        <Pressable style={t.tile} onPress={() => setDetail('sleep')} accessibilityRole="button" accessibilityLabel="Explain sleep estimate"><Text style={s.eyebrow}>Sleep</Text><Text style={s.statValue}>{numberLabel(today.sleep.score)}</Text><Text style={s.body}>{duration(sleepMinutes)}</Text><Text style={[s.note, { color: tone('sleep', today.sleep.state) }]}>{stateLabel(today.sleep.state)} · GainLog estimate</Text></Pressable>
        <Pressable style={t.tile} onPress={() => setDetail('load')} accessibilityRole="button" accessibilityLabel="Explain training load"><Text style={s.eyebrow}>Training load</Text><Text style={s.statValue}>{numberLabel(today.load.loadPoints)}</Text><Text style={s.body}>Load points</Text><Text style={[s.note, { color: tone('load', today.load.state) }]}>{stateLabel(today.load.state)}</Text></Pressable>
      </View>
      <Card title="What matters today"><Text style={s.body}>{todayInterpretation(today.recovery, sleepMinutes)}</Text><Text style={s.note}>Use the estimate alongside how you feel. It does not prescribe your training or diagnose a condition.</Text></Card>
      <StressTimeline data={today.stress} />
      <Card title="Movement today"><View style={s.grid}><Stat label="Recorded steps" value={numberLabel(currentDaily?.steps)} /><Stat label="Recorded exercise" value={duration(currentDaily?.exerciseMinutes)} /></View><Text style={s.note}>{currentDaily ? `Daily feed: ${currentDaily.source} · updated ${new Date(currentDaily.updatedAt).toLocaleString()}` : 'No current-day movement data is loaded.'}</Text><Action title="Explore activity trends" icon="walk-outline" onPress={() => router.push('/trends?metric=recovery' as Href)} /></Card>
      <Text style={s.note}>Health model {today.version} · response checked {feed.checkedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—'}. Checked time is not the wearable’s last sync time. GainLog estimates are not Fitbit or WHOOP scores.</Text>
    </>}
    <Sheet visible={detail !== null} title={detail ? `${stateLabel(detail)} explained` : 'Estimate details'} onClose={() => setDetail(null)}>
      <Text style={s.body}>An experimental GainLog model using available signals and personal baselines. Confidence describes the model’s inputs; it is not a probability of medical accuracy.</Text>
      {selected && <><Text style={s.note}>State: {stateLabel(selected.state)} · confidence: {confidenceLabel(selected.confidence)}</Text>{Object.entries(selected.components).map(([name, component]) => <View key={name}><Text style={s.heading}>{stateLabel(name.replace(/([A-Z])/g, ' $1'))}</Text>{Object.entries(component ?? {}).filter(([, value]) => finite(value)).map(([key, value]) => <Text style={s.note} key={key}>{stateLabel(key.replace(/([A-Z])/g, ' $1'))}: {numberLabel(value, 1)}</Text>)}</View>)}</>}
      <Text style={s.note}>Missing observations remain missing. Scoring formulas and existing backend thresholds are unchanged in this UI release.</Text>
    </Sheet>
  </Page>;
}
const t = StyleSheet.create({ arc: { alignItems: 'center', height: 152 }, arcText: { position: 'absolute', top: 45, alignItems: 'center', gap: 2 }, score: { color: C.text, fontSize: 58, lineHeight: 65, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -2 }, tile: { flexGrow: 1, flexBasis: '44%', backgroundColor: C.surface, borderColor: C.divider, borderWidth: 1, padding: 20, borderRadius: 22, gap: 10, minHeight: 180 } });
