import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { V2Colors as C } from '../../constants/v2Theme';
import type { HealthV2Stress } from '../../types/healthV2';
import { confidenceLabel, finite, numberLabel, stateLabel } from '../../utils/healthspan';
import { Action, Card, Sheet, s } from './ui';

function color(state: string) {
  return ({ low: C.positive, moderate: C.caution, high: C.alert, exercise: C.secondary, activity: '#4E9CD9', sleep: '#6685A3', future: C.future } as Record<string, string>)[state] ?? C.missing;
}
function clock(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
export function StressTimeline({ data }: { data: HealthV2Stress }) {
  const [open, setOpen] = useState(false);
  const elapsed = finite(data.expectedMinutes) ? Math.max(0, Math.min(1440, data.expectedMinutes)) : 0;
  return <Card title="Stress" label="Physiological activation · experimental">
    <Text style={s.body}>{data.baselineReady ? 'Your observed day, in context.' : `Building your baseline · ${numberLabel(data.baselineDays)}/7 days`}</Text>
    <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Open stress timeline. A full day from midnight to midnight, including exercise, sleep and missing data.">
      <View style={t.chart}>
        {data.segments.map(segment => <View key={segment.startMinute} style={{ position: 'absolute', left: `${Math.max(0, Math.min(100, segment.startMinute / 1440 * 100))}%`, width: `${30 / 1440 * 100}%`, bottom: 0, paddingHorizontal: 1 }}>
          <View style={{ height: finite(segment.score) ? 10 + Math.max(0, Math.min(100, segment.score)) * 0.5 : segment.state === 'exercise' ? 30 : 9, backgroundColor: color(segment.state), opacity: segment.state === 'future' ? 0.5 : 1, borderRadius: 2 }} />
        </View>)}
        {elapsed > 0 && elapsed < 1440 && <View style={[t.marker, { left: `${elapsed / 1440 * 100}%` }]} />}
      </View>
      <View style={s.row}>{['00:00', '06:00', '12:00', '18:00', '24:00'].map(time => <Text key={time} style={s.note}>{time}</Text>)}</View>
    </Pressable>
    <Text style={s.note}>Through {clock(elapsed)} · {numberLabel(data.scoredMinutes)} scored minutes · {confidenceLabel(data.confidence).toLowerCase()} model confidence</Text>
    <View style={t.legend}>{['low', 'moderate', 'high', 'exercise', 'activity', 'sleep', 'unobserved', 'future'].map(state => <View key={state} style={t.legendItem}><View style={[t.dot, { backgroundColor: color(state) }]} /><Text style={s.note}>{state === 'unobserved' ? 'Not scored' : stateLabel(state)}</Text></View>)}</View>
    <Text style={s.note}>A retrospective estimate, not a measurement of emotions. Missing or warm-up periods are not scored as low stress.</Text>
    <Action title="Explore this timeline" onPress={() => setOpen(true)} icon="pulse-outline" />
    <Sheet visible={open} title="Stress timeline" onClose={() => setOpen(false)}>
      <Text style={s.body}>Each row represents a 30-minute interval. Scores describe only eligible observations; activity, sleep and missing data are separate states.</Text>
      {data.segments.map(segment => <View key={segment.startMinute} style={s.row}><Text style={s.note}>{clock(segment.startMinute)}–{clock(Math.min(1440, segment.startMinute + 30))}</Text><Text style={s.body}>{stateLabel(segment.state)}{finite(segment.score) ? ` · ${numberLabel(segment.score)}` : ''}</Text></View>)}
    </Sheet>
  </Card>;
}
const t = StyleSheet.create({ chart: { height: 80, borderBottomWidth: 1, borderColor: C.divider, position: 'relative', marginBottom: 8 }, marker: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: C.textSecondary }, legend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, dot: { width: 7, height: 7, borderRadius: 4 } });
