import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { V2Colors as C } from '../../constants/v2Theme';
import { finite } from '../../utils/healthspan';

export function Button({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={({ pressed }) => [j.button, secondary && j.secondaryButton, (disabled || pressed) && { opacity: 0.55 }]}><Text style={[j.buttonText, secondary && { color: C.text }]}>{title}</Text></Pressable>;
}
export function Choice({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected, disabled }} style={[j.choice, selected && { borderColor: C.primary, backgroundColor: C.primaryDim }]}><Text style={{ color: selected ? C.primary : C.textSecondary, fontSize: 13, fontWeight: '600' }}>{label}</Text></Pressable>;
}
export function WeekBars({ values, label, accent = C.primary, binary = false }: { values: (number | null)[]; label: string; accent?: string; binary?: boolean }) {
  const max = Math.max(...values.filter(finite), 1);
  return <View style={j.weekBars} accessible accessibilityLabel={`${label}. ${values.map((n, i) => `Day ${i + 1}: ${n === null ? 'missing' : n}`).join('. ')}`}>
    {values.map((value, i) => <View key={i} style={{ flex: 1, height: 54, justifyContent: 'flex-end' }}><View style={{ height: value === null ? 4 : binary ? value > 0 ? 38 : 4 : Math.max(4, value / max * 48), borderRadius: 4, backgroundColor: value === null || value === 0 && binary ? C.missing : accent }} /></View>)}
  </View>;
}
export const j = StyleSheet.create({
  hero: { padding: 24, borderRadius: 26, backgroundColor: C.elevated, gap: 16, borderTopWidth: 2, borderTopColor: C.primary },
  title: { fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -1.1, color: C.text },
  eyebrow: { fontSize: 11, letterSpacing: 1.8, fontWeight: '700', color: C.primary, textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 23, color: C.textSecondary },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: C.text },
  note: { fontSize: 12, lineHeight: 18, color: C.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  section: { gap: 12, paddingVertical: 8 },
  button: { minHeight: 48, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  secondaryButton: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider },
  buttonText: { fontSize: 14, fontWeight: '700', color: C.background, textAlign: 'center' },
  choice: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 11, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.divider },
  input: { minHeight: 48, borderColor: C.divider, borderWidth: 1, borderRadius: 12, padding: 12, color: C.text, fontSize: 16, backgroundColor: C.background },
  line: { height: 1, backgroundColor: C.divider },
  metric: { minWidth: 90, flexBasis: '29%', flexGrow: 1, borderLeftWidth: 2, borderLeftColor: C.divider, paddingLeft: 12, gap: 7, minHeight: 82 },
  metricValue: { fontSize: 28, lineHeight: 34, color: C.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: 54 },
  error: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.caution, gap: 8 },
});
