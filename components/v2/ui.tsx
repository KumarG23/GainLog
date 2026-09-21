import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { V2Colors as C } from '../../constants/v2Theme';
import { finite, isHealthspanEnabled } from '../../utils/healthspan';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
export function BrandMark({ size = 36 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 256 256" accessibilityLabel="GainLog">
    <Path d="M 183.154 72.846 A 78 78 0 1 0 206 128 H 140" fill="none" stroke={C.primary} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={184} cy={128} r={9} fill={C.secondary} />
  </Svg>;
}
export function Sheet({ visible, title, onClose, children }: React.PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close details" accessibilityRole="button" />
      <SafeAreaView style={s.sheet} edges={['bottom']} accessibilityViewIsModal>
        <View style={s.row}><Text style={s.heading} accessibilityRole="header">{title}</Text><Pressable onPress={onClose} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color={C.text} /></Pressable></View>
        <ScrollView contentContainerStyle={s.sheetContent}>{children}</ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
export function QuickLog() {
  const router = useRouter(); const [open, setOpen] = useState(false);
  const go = (href: string) => { setOpen(false); router.push(href as Href); };
  return <><Pressable onPress={() => setOpen(true)} style={[s.iconButton, s.add]} accessibilityRole="button" accessibilityLabel="Quick log"><Ionicons name="add" size={24} color={C.background} /></Pressable>
    <Sheet visible={open} title="Add to your day" onClose={() => setOpen(false)}>
      <Action title="Log a workout" detail="Your existing templates, sets and cardio" icon="barbell-outline" onPress={() => go(isHealthspanEnabled() ? '/workout' : '/(tabs)')} />
      <Action title="Log food" detail="Meals, protein, fiber and energy" icon="restaurant-outline" onPress={() => go('/(tabs)/nutrition')} />
      {isHealthspanEnabled() && <Action title="Weight & goals" detail="Record weight or manage your targets" icon="scale-outline" onPress={() => go('/(tabs)/health')} />}
      <Text style={s.note}>Nothing is saved until you submit the entry form.</Text>
    </Sheet></>;
}
export function Page({ title, subtitle, refreshing = false, onRefresh, error, loading = false, children }: React.PropsWithChildren<{ title: string; subtitle?: string; refreshing?: boolean; onRefresh?: () => Promise<void>; error?: string | null; loading?: boolean }>) {
  const router = useRouter();
  return <SafeAreaView style={s.screen} edges={['top']}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={C.primary} /> : undefined}>
      <View style={s.brandRow}><View style={s.brand}><BrandMark /><View><Text style={s.wordmark}>GainLog</Text><Text style={s.tagline}>BUILD YOUR HEALTHSPAN</Text></View></View>
        <View style={s.actions}><QuickLog /><Pressable style={s.iconButton} onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Open settings"><Ionicons name="person-outline" size={21} color={C.text} /></Pressable></View>
      </View>
      <View style={s.intro}><Text style={s.title} accessibilityRole="header">{title}</Text>{subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>
      {!!error && <View style={s.error} accessibilityLiveRegion="polite"><Text style={s.body}>Could not refresh. Previously loaded values may be stale.</Text><Text style={s.note}>{error}</Text>{onRefresh && <Action title="Retry" onPress={() => void onRefresh()} icon="refresh-outline" />}</View>}
      {loading && <ActivityIndicator color={C.primary} accessibilityLabel="Loading health data" />}
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function Card({ title, label, children }: React.PropsWithChildren<{ title?: string; label?: string }>) {
  return <View style={s.card}>{label && <Text style={s.eyebrow}>{label}</Text>}{title && <Text style={s.heading} accessibilityRole="header">{title}</Text>}{children}</View>;
}
export function Action({ title, detail, icon = 'chevron-forward', onPress }: { title: string; detail?: string; icon?: Icon; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.action, pressed && s.pressed]}>
    <Ionicons name={icon} size={21} color={C.primary} /><View style={s.flex}><Text style={s.actionTitle}>{title}</Text>{detail && <Text style={s.note}>{detail}</Text>}</View><Ionicons name="chevron-forward" size={17} color={C.textSecondary} />
  </Pressable>;
}
export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <View style={s.stat}><Text style={s.note}>{label}</Text><Text style={s.statValue}>{value}</Text>{detail && <Text style={s.note}>{detail}</Text>}</View>;
}
export function Sparkline({ points, label }: { points: (number | null)[]; label: string }) {
  const values = points.filter(finite);
  if (!values.length) return <Text style={s.note}>No observations in this window.</Text>;
  const low = Math.min(...values), high = Math.max(...values), spread = high - low || 1;
  let path = '', connected = false;
  const dots: { x: number; y: number }[] = [];
  points.forEach((value, index) => {
    if (!finite(value)) { connected = false; return; }
    const x = 4 + index * 272 / Math.max(1, points.length - 1), y = high === low ? 30 : 54 - (value - low) / spread * 46;
    path += `${connected ? 'L' : 'M'} ${x} ${y} `; connected = true; dots.push({ x, y });
  });
  return <Svg height={60} width="100%" viewBox="0 0 280 60" accessibilityLabel={label} accessible>
    <Path d={path} fill="none" stroke={C.primary} strokeWidth={2.5} strokeLinecap="round" />
    {dots.map((dot, i) => <Circle key={i} cx={dot.x} cy={dot.y} r={2.5} fill={C.primary} />)}
  </Svg>;
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { padding: 20, paddingBottom: 36, gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  wordmark: { fontSize: 21, fontWeight: '800', letterSpacing: -0.7, color: C.text },
  tagline: { fontSize: 9, fontWeight: '700', letterSpacing: 1.15, color: C.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 4 }, iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  add: { backgroundColor: C.primary }, intro: { gap: 6, marginVertical: 6 }, title: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: C.text },
  subtitle: { fontSize: 14, lineHeight: 21, color: C.textSecondary },
  card: { borderRadius: 24, padding: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, gap: 12 },
  eyebrow: { color: C.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  heading: { color: C.text, fontSize: 20, fontWeight: '700', flexShrink: 1 }, body: { color: C.text, fontSize: 15, lineHeight: 23 }, note: { color: C.textSecondary, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, flex: { flex: 1 },
  stat: { flexGrow: 1, flexBasis: '44%', padding: 16, borderRadius: 18, backgroundColor: C.elevated, gap: 6 },
  statValue: { color: C.text, fontSize: 29, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'] },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 }, actionTitle: { color: C.text, fontSize: 15, fontWeight: '600' }, pressed: { opacity: 0.65 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }, sheet: { backgroundColor: C.surface, padding: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', width: '100%', maxWidth: 760, alignSelf: 'center' }, sheetContent: { gap: 12, paddingBottom: 20 },
  error: { backgroundColor: C.elevated, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.caution, gap: 8 },
});
