import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { HealthV2Stress } from '../../types/healthV2';
import { V2Colors as C } from '../../constants/v2Theme';
import { finite, numberLabel, stateLabel } from '../../utils/healthspan';
import { clockLabel, segmentIndexForMinute } from '../../utils/dayJourney';
import { Button, j } from './primitives';
const palette: Record<string, string> = { low: C.primary, moderate: C.caution, high: C.alert, exercise: C.secondary, activity: '#4E9CD9', sleep: '#6685A3', future: C.future };
const timeMarks = [{ label: '00:00', minute: 0 }, { label: '06:00', minute: 360 }, { label: '12:00', minute: 720 }, { label: '18:00', minute: 1080 }, { label: '24:00', minute: 1439 }];
export function DayStress({ data, onNote }: { data: HealthV2Stress; onNote: (minute: number) => void }) {
  const [selected, select] = useState<number | null>(null), [width, setWidth] = useState(1);
  const segment = selected === null ? null : data.segments[selected];
  const pickMinute = (minute: number) => {
    const i = segmentIndexForMinute(data.segments, minute);
    if (i >= 0) select(i);
  };
  const pick = (x: number) => pickMinute(x / width * 1440);
  return <View style={j.section}><View style={[j.row, { justifyContent: 'space-between' }]}><Text style={j.heading}>Your day, in context</Text><Text style={j.note}>Stress · experimental</Text></View>
    <Text style={j.body}>{data.baselineReady ? 'Explore activation alongside sleep and activity.' : `Building a personal baseline · ${data.baselineDays}/7 days. Your recorded activity still appears.`}</Text>
    <View accessibilityRole="adjustable" accessibilityLabel="Stress timeline. Swipe or use previous and next period controls below." accessibilityValue={{ min: 0, max: Math.max(0, data.segments.length - 1), now: selected ?? 0, text: segment ? `${clockLabel(segment.startMinute)} ${stateLabel(segment.state)}` : 'Select a period' }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => select(i => Math.max(0, Math.min(data.segments.length - 1, (i ?? 0) + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))} onLayout={e => setWidth(Math.max(1, e.nativeEvent.layout.width))} onStartShouldSetResponder={() => true} onResponderGrant={e => pick(e.nativeEvent.locationX)} onResponderMove={e => pick(e.nativeEvent.locationX)} style={{ height: 104, backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden' }}>
      {data.segments.map((s, i) => <View key={s.startMinute} style={{ position: 'absolute', bottom: 0, left: `${s.startMinute / 1440 * 100}%`, width: `${30 / 1440 * 100}%`, height: finite(s.score) ? 12 + Math.max(0, Math.min(100, s.score)) * 0.8 : s.state === 'exercise' ? 44 : s.state === 'sleep' ? 22 : 7, backgroundColor: palette[s.state] ?? C.missing, borderWidth: selected === i ? 1 : 0, borderColor: C.text, opacity: selected === null || selected === i ? 1 : 0.65 }} />)}
      {finite(data.expectedMinutes) && data.expectedMinutes < 1440 && <View style={{ position: 'absolute', left: `${data.expectedMinutes / 1440 * 100}%`, top: 0, bottom: 0, width: 1, backgroundColor: C.textSecondary }} />}
    </View>
    <View style={[j.row, { justifyContent: 'space-between' }]}>{timeMarks.map(({ label, minute }) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Select ${label} on the stress timeline`} hitSlop={4} onPress={() => pickMinute(minute)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={j.note}>{label}</Text></Pressable>)}</View>
    <View style={j.row}><Text style={[j.note, { color: C.secondary }]}>● Exercise</Text><Text style={[j.note, { color: '#6685A3' }]}>● Sleep</Text><Text style={j.note}>Gaps = unscored · dim = future</Text></View>
    <View style={j.row}><Button secondary title="Previous period" onPress={() => select(i => Math.max(0, (i ?? 1) - 1))} disabled={!data.segments.length || selected === 0} /><Button secondary title="Next period" onPress={() => select(i => Math.min(data.segments.length - 1, (i ?? -1) + 1))} disabled={!data.segments.length || selected === data.segments.length - 1} /></View>
    {segment && <View style={{ padding: 16, backgroundColor: C.elevated, borderRadius: 14, gap: 10 }}><Text style={j.heading}>{clockLabel(segment.startMinute)} · {stateLabel(segment.state)}</Text><Text style={j.body}>{finite(segment.score) ? `Activation estimate ${numberLabel(segment.score)}. This is not a measurement of emotional stress.` : segment.state === 'exercise' ? 'Recorded exercise context—not classified as emotional stress.' : segment.state === 'future' ? 'This part of your day has not happened yet.' : 'No activation score for this interval. Missing data is not low stress.'}</Text><Button secondary title="Add context to my check-in" disabled={segment.state === 'future' || segment.startMinute >= data.expectedMinutes} onPress={() => onNote(segment.startMinute)} /></View>}
    <Text style={j.note}>{data.scoredMinutes} eligible minutes scored · retrospective, not streaming. Tap a time label or touch and drag the bars to explore.</Text>
  </View>;
}
