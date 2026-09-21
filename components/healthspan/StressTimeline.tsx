import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { V2Colors as C } from '../../constants/v2Theme';
import type { HealthV2Stress } from '../../types/healthV2';
import { label, numberLabel, timeAtMinute } from '../../utils/healthspan';
import { Body, Card, Eyebrow, LinkRow, styles } from './UI';

const states: Record<string, { color: string; text: string }> = {
  low: { color: C.positive, text: 'Low' }, moderate: { color: C.caution, text: 'Moderate' }, high: { color: C.alert, text: 'High' },
  exercise: { color: C.secondary, text: 'Exercise' }, activity: { color: C.activity, text: 'Movement' }, sleep: { color: C.sleep, text: 'Sleep' },
  baseline_unavailable: { color: C.missing, text: 'Building baseline' }, context_unavailable: { color: C.missing, text: 'Context missing' },
  unobserved: { color: C.missing, text: 'Unobserved' }, future: { color: C.future, text: 'Future' },
};
export function StressTimeline({ data, detail = false }: { data: HealthV2Stress; detail?: boolean }) {
  const elapsed = Math.max(0, Math.min(1440, data.expectedMinutes));
  const seenStates = [...new Set(data.segments.map(segment => segment.state))];
  return <Card>
    <Eyebrow>Stress</Eyebrow>
    <Text style={styles.sectionTitle}>Your day, in context</Text>
    <Body muted>Retrospective physiological activation</Body>
    <View accessible accessibilityLabel={`Timeline for the full day. Snapshot requested through ${timeAtMinute(elapsed)}. ${data.scoredMinutes} scored minutes; ${data.observedHeartRateMinutes} minutes with heart-rate observations. Not a live stress reading.`}>
      <Svg width="100%" height={112} viewBox="0 0 720 112">
        {data.segments.map(segment => {
          const height = segment.score == null ? 10 : 12 + segment.score * 0.7;
          return <Rect key={segment.startMinute} x={segment.startMinute / 2 + 1} y={92 - height} width={13} height={height} rx={2} fill={states[segment.state]?.color ?? C.missing} />;
        })}
        <Line x1={elapsed / 2} y1={4} x2={elapsed / 2} y2={95} stroke={C.textSecondary} strokeWidth={1} strokeDasharray="3 3" />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{['00:00', '06:00', '12:00', '18:00', '24:00'].map(time => <Text key={time} style={styles.caption}>{time}</Text>)}</View>
    </View>
    <View style={[styles.row, { flexWrap: 'wrap', gap: 12 }]}>{seenStates.map(state => <View style={[styles.row, { gap: 5 }]} key={state}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: states[state]?.color ?? C.missing }} /><Text style={styles.caption}>{states[state]?.text ?? label(state)}</Text></View>)}</View>
    <Body>{data.baselineReady ? `${numberLabel(data.scoredMinutes)} scored minutes · ${numberLabel(data.observedHeartRateMinutes)} minutes with heart-rate data` : `Personal baseline: ${data.baselineDays}/7 days. Warm-up periods are not scored.`}</Body>
    <Text style={styles.caption}>The line marks snapshot time, not sensor freshness. This is not a live reading or a measure of emotional stress. Missing context stays unscored.</Text>
    {!detail && <LinkRow title="Explore the timeline" href="/health-metric?metric=stress" />}
    {detail && data.segments.filter(segment => segment.state !== 'future').map(segment => <View key={segment.startMinute} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.divider }}><Text style={styles.linkTitle}>{timeAtMinute(segment.startMinute)}–{timeAtMinute(Math.min(segment.startMinute + 30, elapsed))} · {states[segment.state]?.text ?? label(segment.state)}</Text><Body muted>{segment.score == null ? 'No activation score in this interval' : `Average activation ${numberLabel(segment.score)} / 100 · data confidence ${numberLabel(segment.confidence * 100)}%`}</Body></View>)}
  </Card>;
}
