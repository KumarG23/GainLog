import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { API_URL } from '../constants/api';
import { V2Colors } from '../constants/v2Theme';
import { HealthV2StressSegment, HealthV2Today } from '../types/healthV2';
import { localDateKey } from '../utils/date';
import {
  buildTodayFocus,
  formatConfidence,
  formatDuration,
  healthV2Tone,
} from '../utils/healthV2Today';

const ARC_LENGTH = 282;

function stateLabel(state: string) {
  return state.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function stateColor(metric: 'recovery' | 'sleep' | 'load' | 'stress', state: string) {
  const tone = healthV2Tone(metric, state);
  if (tone === 'positive') return V2Colors.positive;
  if (tone === 'caution') return V2Colors.caution;
  if (tone === 'alert') return V2Colors.alert;
  return V2Colors.textMuted;
}

function RecoveryArc({ score, state }: { score: number | null; state: string }) {
  const progress = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <View style={styles.arcWrap} accessibilityLabel={`Recovery ${score ?? 'unavailable'}, ${stateLabel(state)}`}>
      <Svg width={222} height={126} viewBox="0 0 222 126">
        <Path
          d="M 21 111 A 90 90 0 0 1 201 111"
          fill="none"
          stroke={V2Colors.divider}
          strokeWidth={11}
          strokeLinecap="round"
        />
        <Path
          d="M 21 111 A 90 90 0 0 1 201 111"
          fill="none"
          stroke={score == null ? V2Colors.textMuted : stateColor('recovery', state)}
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH * progress / 100} ${ARC_LENGTH}`}
        />
      </Svg>
      <View style={styles.arcCopy}>
        <Text style={styles.recoveryScore}>{score ?? '—'}</Text>
        <Text style={[styles.recoveryState, { color: stateColor('recovery', state) }]}>{stateLabel(state)}</Text>
      </View>
    </View>
  );
}

function Signal({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.signal}>
      <Text style={[styles.signalValue, accent && styles.accentText]} numberOfLines={1}>{value}</Text>
      <Text style={styles.signalLabel}>{label}</Text>
    </View>
  );
}

function MetricCard({
  icon,
  metric,
  title,
  value,
  state,
  detail,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  metric: 'sleep' | 'load';
  title: string;
  value: string;
  state: string;
  detail: string;
}) {
  return (
    <View style={styles.metricCard} accessible accessibilityLabel={`${title}: ${value}. ${state}. ${detail}`}>
      <View style={styles.cardTitleRow}>
        <View style={styles.iconWell}>
          <Ionicons name={icon} size={17} color={V2Colors.primary} />
        </View>
        <Text style={styles.cardEyebrow}>{title}</Text>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={[styles.metricState, { color: stateColor(metric, state) }]}>{stateLabel(state)}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function segmentColor(segment: HealthV2StressSegment) {
  if (segment.state === 'low') return V2Colors.positive;
  if (segment.state === 'moderate') return V2Colors.caution;
  if (segment.state === 'high') return V2Colors.alert;
  if (segment.state === 'exercise') return V2Colors.secondary;
  if (segment.state === 'activity') return '#4E9CD9';
  if (segment.state === 'sleep') return '#31506B';
  if (segment.state === 'future') return V2Colors.future;
  return V2Colors.missing;
}

function StressRibbon({ data }: { data: HealthV2Today['stress'] }) {
  return (
    <View style={styles.stressCard}>
      <View style={styles.cardTitleRow}>
        <View style={styles.iconWell}>
          <Ionicons name="pulse-outline" size={17} color={V2Colors.primary} />
        </View>
        <Text style={styles.cardEyebrow}>Physiological activation</Text>
      </View>
      <View style={styles.stressLabels}>
        <Text style={styles.stressLabel}>Low</Text>
        <Text style={styles.stressLabel}>Moderate</Text>
        <Text style={styles.stressLabel}>High</Text>
      </View>
      <View style={styles.stressBars} accessibilityLabel={`Physiological activation ${stateLabel(data.state)}`}>
        {data.segments.map(segment => {
          const height = segment.score == null
            ? segment.state === 'exercise' ? 30 : segment.state === 'activity' ? 20 : 10
            : 10 + segment.score * 0.38;
          return (
            <View
              key={segment.startMinute}
              style={[
                styles.stressBar,
                {
                  height,
                  backgroundColor: segmentColor(segment),
                  opacity: segment.state === 'future' ? 0.35 : Math.max(0.45, segment.confidence),
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.timelineFooter}>
        <Text style={styles.timelineLabel}>12 AM</Text>
        <Text style={styles.timelineLabel}>Now</Text>
      </View>
      <Text style={styles.stressNote}>
        {data.baselineReady
          ? `${data.scoredMinutes} context-qualified minutes · ${formatConfidence(data.confidence)}`
          : `Personal baseline ${data.baselineDays}/7 days · warm-up data is not scored`}
      </Text>
      <View style={styles.legendRow}>
        <Text style={styles.legendText}>Purple exercise</Text>
        <Text style={styles.legendText}>Slate missing</Text>
        <Text style={styles.legendText}>Dim future</Text>
      </View>
    </View>
  );
}

export function TodayV2() {
  const router = useRouter();
  const [today, setToday] = useState<HealthV2Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const date = localDateKey();
      const response = await fetch(`${API_URL}/health-v2/today?date=${encodeURIComponent(date)}`);
      if (!response.ok) throw new Error(`Today V2 request failed: ${response.status}`);
      setToday(await response.json() as HealthV2Today);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Today V2 is unavailable.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const dateLabel = useMemo(() => {
    const value = today?.date ?? localDateKey();
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
      .format(new Date(`${value}T12:00:00`));
  }, [today?.date]);

  if (!today && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={V2Colors.primary} />
          <Text style={styles.loadingText}>Reading today’s signals…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!today) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loading}>
          <Ionicons name="cloud-offline-outline" size={28} color={V2Colors.caution} />
          <Text style={styles.errorTitle}>Today V2 unavailable</Text>
          <Text style={styles.loadingText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const sleepMinutes = today.sleep.components.duration?.valueMinutes;
  const hrv = today.recovery.components.hrv;
  const restingHeartRate = today.recovery.components.restingHeartRate;
  const focus = buildTodayFocus({
    recoveryState: today.recovery.state,
    stressState: today.stress.state,
  });
  const loadDetail = today.load.baseline
    ? `${today.load.baseline.ratio.toFixed(2)}× recent active-day median`
    : today.load.state === 'rest'
      ? 'Supported rest day'
      : 'Building your active-day baseline';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={V2Colors.primary} />}
      >
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.wordmark}>Gain<Text style={styles.wordmarkAccent}>Log</Text></Text>
            <Text style={styles.tagline}>LONGER LIVES · BRIGHTER DAYS</Text>
          </View>
          <Pressable
            style={styles.headerButton}
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Ionicons name="person-outline" size={19} color={V2Colors.text} />
          </Pressable>
        </View>

        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>Good morning, Neal</Text>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>
        <Text style={styles.experimental}>V2 · EXPERIMENTAL PERSONAL BASELINES</Text>

        <View style={styles.hero}>
          <View style={styles.heroGlowOne} />
          <View style={styles.heroGlowTwo} />
          <View style={styles.cardTitleRow}>
            <View style={styles.iconWell}>
              <Ionicons name="heart-outline" size={17} color={V2Colors.primary} />
            </View>
            <Text style={styles.cardEyebrow}>Recovery</Text>
          </View>
          <Text style={styles.heroCopy}>Your morning state, explained by the signals actually available.</Text>
          <RecoveryArc score={today.recovery.score} state={today.recovery.state} />
          <View style={styles.signalRow}>
            <Signal
              label="HRV vs baseline"
              value={hrv?.deviationPercent == null ? 'Unavailable' : `${hrv.deviationPercent >= 0 ? '+' : ''}${hrv.deviationPercent.toFixed(1)}%`}
              accent={hrv?.deviationPercent != null && hrv.deviationPercent >= 0}
            />
            <View style={styles.signalDivider} />
            <Signal
              label="Resting HR"
              value={restingHeartRate?.valueBpm == null ? 'Unavailable' : `${restingHeartRate.valueBpm.toFixed(0)} bpm`}
            />
            <View style={styles.signalDivider} />
            <Signal label="Sleep duration" value={formatDuration(sleepMinutes)} />
          </View>
          <Text style={styles.confidence}>{formatConfidence(today.recovery.confidence)} · Google Health V2</Text>
        </View>

        <View style={styles.metricRow}>
          <MetricCard
            icon="moon-outline"
            metric="sleep"
            title="Sleep"
            value={today.sleep.score?.toFixed(0) ?? '—'}
            state={today.sleep.state}
            detail={formatDuration(sleepMinutes)}
          />
          <MetricCard
            icon="barbell-outline"
            metric="load"
            title="Load"
            value={today.load.loadPoints?.toFixed(0) ?? '—'}
            state={today.load.state}
            detail={loadDetail}
          />
        </View>

        <StressRibbon data={today.stress} />

        <View style={styles.focusCard}>
          <View style={styles.cardTitleRow}>
            <View style={styles.iconWell}>
              <Ionicons name="locate-outline" size={17} color={V2Colors.primary} />
            </View>
            <Text style={styles.cardEyebrow}>Today’s focus</Text>
          </View>
          <Text style={styles.focusText}>{focus}</Text>
          <Text style={styles.focusMeta}>Read-only interpretation · no coaching or writes</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: V2Colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  loadingText: { color: V2Colors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  errorTitle: { color: V2Colors.text, fontSize: 20, fontWeight: '700' },
  retryButton: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, justifyContent: 'center', backgroundColor: V2Colors.primary },
  retryText: { color: V2Colors.background, fontWeight: '800' },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  wordmark: { color: V2Colors.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.8 },
  wordmarkAccent: { color: V2Colors.primary },
  tagline: { color: V2Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 1.65, marginTop: 1 },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V2Colors.divider },
  greetingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
  greeting: { color: V2Colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.7 },
  date: { color: V2Colors.textSecondary, fontSize: 13 },
  experimental: { color: V2Colors.primary, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: -7 },
  hero: { minHeight: 320, borderRadius: 24, padding: 18, backgroundColor: V2Colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: V2Colors.divider },
  heroGlowOne: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(99, 230, 208, 0.07)', top: -90, right: -50 },
  heroGlowTwo: { position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(124, 140, 255, 0.06)', bottom: -80, left: -40 },
  cardTitleRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconWell: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: V2Colors.primaryDim },
  cardEyebrow: { color: V2Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.25, textTransform: 'uppercase' },
  heroCopy: { color: V2Colors.textSecondary, fontSize: 13, lineHeight: 18, maxWidth: 260, marginTop: 2 },
  arcWrap: { height: 135, alignItems: 'center', justifyContent: 'flex-start', marginTop: 6 },
  arcCopy: { position: 'absolute', top: 45, alignItems: 'center' },
  recoveryScore: { color: V2Colors.text, fontSize: 58, lineHeight: 62, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  recoveryState: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  signalRow: { minHeight: 58, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: V2Colors.divider, paddingTop: 13 },
  signal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  signalValue: { color: V2Colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  signalLabel: { color: V2Colors.textMuted, fontSize: 9, marginTop: 4, textAlign: 'center' },
  signalDivider: { width: 1, backgroundColor: V2Colors.divider },
  accentText: { color: V2Colors.primary },
  confidence: { color: V2Colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 7 },
  metricRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, minHeight: 180, borderRadius: 20, padding: 16, backgroundColor: V2Colors.surface, borderWidth: 1, borderColor: V2Colors.divider },
  metricValue: { color: V2Colors.text, fontSize: 40, fontWeight: '800', letterSpacing: -1.5, marginTop: 14, fontVariant: ['tabular-nums'] },
  metricState: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  metricDetail: { color: V2Colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 10 },
  stressCard: { minHeight: 205, borderRadius: 20, padding: 16, backgroundColor: V2Colors.surface, borderWidth: 1, borderColor: V2Colors.divider },
  stressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  stressLabel: { color: V2Colors.textMuted, fontSize: 9 },
  stressBars: { height: 54, flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 5, borderBottomWidth: 1, borderBottomColor: V2Colors.divider },
  stressBar: { flex: 1, minWidth: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  timelineFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  timelineLabel: { color: V2Colors.textMuted, fontSize: 9 },
  stressNote: { color: V2Colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 9 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 5 },
  legendText: { color: V2Colors.textMuted, fontSize: 9 },
  focusCard: { minHeight: 155, borderRadius: 20, padding: 18, backgroundColor: V2Colors.elevated, borderWidth: 1, borderColor: V2Colors.divider },
  focusText: { color: V2Colors.text, fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 330 },
  focusMeta: { color: V2Colors.textMuted, fontSize: 10, marginTop: 14 },
});
