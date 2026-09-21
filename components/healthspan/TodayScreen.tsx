import React, { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Href, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { V2Colors as C } from '../../constants/v2Theme';
import { useTodayHealth } from '../../context/TodayHealthContext';
import { useHealth } from '../../context/HealthContext';
import { useWorkouts } from '../../context/WorkoutsContext';
import type { HealthV2Today } from '../../types/healthV2';
import { durationLabel, finite, greeting, label, localDay, numberLabel, signalStory } from '../../utils/healthspan';
import { Body, Button, Card, Empty, Eyebrow, LinkRow, Notice, Screen, Stat, styles } from './UI';
import { StressTimeline } from './StressTimeline';

const tone = (state: string) => state === 'high' ? C.positive : state === 'moderate' ? C.caution : state === 'low' ? C.alert : C.textMuted;
function RecoveryHero({ data }: { data: HealthV2Today }) {
  const router = useRouter();
  const { recovery } = data;
  const circumference = 2 * Math.PI * 51;
  return <Pressable accessibilityRole="button" accessibilityLabel={`GainLog recovery ${recovery.score ?? 'unavailable'}. Experimental model. View its components.`} onPress={() => router.push('/health-metric?metric=recovery')}>
    <Card accent>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Eyebrow>Morning recovery</Eyebrow><Text style={[styles.caption, { color: C.primary }]}>EXPERIMENTAL</Text></View>
      <View style={[styles.row, { gap: 18 }]}>
        <View style={styles.flex}>
          <Text style={{ color: recovery.score == null ? C.textMuted : tone(recovery.state), fontSize: 26, fontWeight: '600', letterSpacing: -0.7 }}>{label(recovery.state)}</Text>
          <Body>Your morning signals, compared with your own baseline.</Body>
          <Text style={[styles.caption, { marginTop: 10 }]}>See what shaped this score ↗</Text>
        </View>
        <View style={{ width: 126, height: 126, justifyContent: 'center', alignItems: 'center' }}>
          <Svg width={126} height={126} viewBox="0 0 126 126" style={{ position: 'absolute' }}>
            <Circle cx={63} cy={63} r={51} fill="none" stroke={C.divider} strokeWidth={7} />
            <Circle cx={63} cy={63} r={51} fill="none" stroke={tone(recovery.state)} strokeWidth={7} strokeDasharray={`${circumference * (recovery.score ?? 0) / 100} ${circumference}`} strokeLinecap="round" rotation={-90} origin="63,63" />
          </Svg>
          <Text style={{ color: C.text, fontSize: 46, fontWeight: '700', letterSpacing: -2, fontVariant: ['tabular-nums'] }}>{numberLabel(recovery.score)}</Text><Text style={styles.caption}>/ 100</Text>
        </View>
      </View>
      <View style={[styles.grid, { borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 15 }]}>
        <Stat label="HRV" value={numberLabel(recovery.components.hrv?.valueMs, 1)} unit="ms" />
        <Stat label="Resting HR" value={numberLabel(recovery.components.restingHeartRate?.valueBpm)} unit="bpm" />
      </View>
      <Text style={styles.caption}>GainLog estimate · not a medical assessment or a command to train.</Text>
    </Card>
  </Pressable>;
}
function SmallMetric({ title, value, unit, detail, href }: { title: string; value: string; unit: string; detail: string; href: Href }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${value} ${unit}. ${detail}. View details.`} onPress={() => router.push(href)} style={styles.trendTile}><Eyebrow>{title}</Eyebrow><Text style={styles.statValue}>{value}<Text style={styles.unit}> {unit}</Text></Text><Body>{detail}</Body><Text style={styles.caption}>GainLog model · tap to explore</Text></Pressable>;
}
export function TodayScreen() {
  const snapshot = useTodayHealth();
  const health = useHealth();
  const workouts = useWorkouts();
  useFocusEffect(useCallback(() => { void snapshot.refresh(); }, [snapshot.refresh]));
  const refresh = () => { void Promise.all([snapshot.refresh(true), health.refresh(), workouts.refresh()]); };
  const current = health.dashboardSummary?.todayHealth;
  const daily = current?.date === localDay() ? current : null;
  const data = snapshot.data;
  return <Screen title={greeting(new Date().getHours())} subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} onRefresh={refresh} refreshing={snapshot.refreshing || health.loading} loading={!data && !snapshot.error}>
    <Notice error={snapshot.error} />
    {!data ? <Card><Text style={styles.sectionTitle}>Your signals are unavailable</Text><Body>No replacement scores are invented. Your logging tools still work.</Body><Button title="Try again" onPress={refresh} /><LinkRow title="Open connection settings" href="/settings" /></Card> : <>
      <RecoveryHero data={data} />
      <View style={styles.grid}>
        <SmallMetric title="Sleep" value={numberLabel(data.sleep.score)} unit="/ 100" detail={`${durationLabel(data.sleep.components.duration?.valueMinutes)} · ${label(data.sleep.state)}`} href="/health-metric?metric=sleep" />
        <SmallMetric title="Training load" value={numberLabel(data.load.loadPoints)} unit="points" detail={label(data.load.state)} href="/health-metric?metric=load" />
      </View>
      <Card><Eyebrow>What stands out</Eyebrow><Text style={[styles.body, { color: C.text, fontSize: 16, lineHeight: 25 }]}>{signalStory(data)}</Text><LinkRow title="Explore your health trends" href="/healthspan" /></Card>
      <StressTimeline data={data.stress} />
    </>}
    <Notice error={health.error ? 'Saved activity could not be refreshed. Previously loaded entries may still be shown.' : null} />
    <Card><Eyebrow>Movement so far</Eyebrow><View style={styles.grid}><Stat label="Steps" value={numberLabel(daily?.steps)} /><Stat label="Exercise" value={numberLabel(daily?.exerciseMinutes)} unit="min" /></View><Body muted>Reconciled daily totals · an unfinished day, not a final result.</Body><LinkRow title="Training & activity" href="/train" /></Card>
    <Text style={styles.caption}>{snapshot.fetchedAt ? `Summary retrieved ${snapshot.fetchedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. ` : ''}Retrieval time is not device sync time. Wearable data may arrive later.</Text>
  </Screen>;
}
export function MetricDetailScreen() {
  const { metric: requested } = useLocalSearchParams<{ metric?: string }>();
  const metric = requested === 'sleep' || requested === 'load' || requested === 'stress' ? requested : 'recovery';
  const snapshot = useTodayHealth();
  useFocusEffect(useCallback(() => { void snapshot.refresh(); }, [snapshot.refresh]));
  const data = snapshot.data;
  const domain = data?.[metric];
  const refresh = () => { void snapshot.refresh(true); };
  return <Screen title={metric === 'load' ? 'Training load' : label(metric)} subtitle="Your measurements. An explainable estimate." onRefresh={refresh} refreshing={snapshot.refreshing} loading={!data && !snapshot.error}>
    <Notice error={snapshot.error} />
    {!data || !domain ? <Empty title="No summary available" detail="Return to Today or check your data connection. No values have been filled in." /> : <>
      {metric === 'stress' ? <StressTimeline data={data.stress} detail /> : <>
        <Card accent><Eyebrow>GainLog {metric}</Eyebrow><Text style={styles.statValue}>{numberLabel(metric === 'load' ? data.load.loadPoints : data[metric].score)}<Text style={styles.unit}> {metric === 'load' ? 'points' : '/ 100'}</Text></Text><Body>{label(domain.state)}</Body><Body muted>Input confidence: {numberLabel(domain.confidence * 100)}%. This is a model data-quality indicator, not a statistical probability of accuracy.</Body></Card>
        <Card><Eyebrow>What goes into it</Eyebrow>
          {Object.entries(data[metric].components).map(([name, component]) => <View key={name} style={{ borderBottomWidth: 1, borderBottomColor: C.divider, paddingVertical: 10, gap: 6 }}><Text style={styles.linkTitle}>{label(name.replace(/([A-Z])/g, ' $1'))}</Text>
            {Object.entries(component).filter(([, value]) => finite(value)).map(([key, value]) => <Text key={key} style={styles.caption}>{label(key.replace(/([A-Z])/g, ' $1'))}: {numberLabel(value, 2)}</Text>)}
          </View>)}
          {!Object.keys(data[metric].components).length && <Body>No scoreable components are available yet.</Body>}
        </Card>
      </>}
      <Card><Eyebrow>About this estimate</Eyebrow><Body>Model {data.version} · {data.provenance}</Body>
        <Body>{metric === 'stress' ? 'Activation reflects available physiology and context, not thoughts or feelings. Exercise, movement, sleep and unknown periods are kept distinct. It is not an inverse readiness score.' : metric === 'load' ? 'Load uses wearable exercise duration and overlapping heart-rate-zone time. It does not measure the full muscular cost of lifting, and it is not an injury-risk prediction.' : metric === 'sleep' ? 'This is GainLog’s sleep estimate, not a Fitbit or WHOOP sleep score. It uses duration, efficiency and personal timing consistency when those inputs are available.' : 'Recovery combines available sleep, HRV and resting-heart-rate components. Missing optional signals are not penalties. Baselines need sufficient prior observations; this model has not been validated to predict training outcomes.'}</Body>
      </Card>
    </>}
  </Screen>;
}
