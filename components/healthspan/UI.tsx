import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { V2Colors as C } from '../../constants/v2Theme';
import { useHealth } from '../../context/HealthContext';
import { localIsoTimestamp } from '../../utils/date';
import { finite, localDay, numberLabel, shiftDay, sparklineGeometry, type TrendWindow } from '../../utils/healthspan';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
export function BaselineMark({ size = 32 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 1024 1024"><Path d="M729 311 A296 296 0 1 0 808 512 H548" fill="none" stroke={C.primary} strokeWidth={74} strokeLinecap="round" strokeLinejoin="round" /><Circle cx={548} cy={512} r={37} fill={C.background} /><Circle cx={548} cy={512} r={26} fill={C.secondary} /></Svg>;
}
export function Body({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) { return <Text style={[styles.body, muted && { color: C.textMuted }]}>{children}</Text>; }
export function Eyebrow({ children }: { children: React.ReactNode }) { return <Text style={styles.eyebrow}>{children}</Text>; }
export function Card({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) { return <View style={[styles.card, accent && { backgroundColor: C.elevated }]}>{children}</View>; }
export function Button({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, (pressed || disabled) && { opacity: 0.6 }]}><Text style={[styles.buttonText, secondary && { color: C.text }]}>{title}</Text></Pressable>;
}
export function LinkRow({ title, subtitle, href, icon = 'chevron-forward' }: { title: string; subtitle?: string; href: Href; icon?: Icon }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} onPress={() => router.push(href)} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}><View style={styles.flex}><Text style={styles.linkTitle}>{title}</Text>{subtitle && <Text style={styles.caption}>{subtitle}</Text>}</View><Ionicons name={icon} size={20} color={C.primary} /></Pressable>;
}
export function Notice({ error }: { error: string | null | undefined }) { return error ? <View accessibilityRole="alert" style={styles.notice}><Ionicons name="cloud-offline-outline" size={20} color={C.caution} /><Text style={[styles.body, styles.flex]}>{error}</Text></View> : null; }
export function Empty({ title, detail }: { title: string; detail: string }) { return <Card><Text style={styles.sectionTitle}>{title}</Text><Body muted>{detail}</Body></Card>; }

function QuickLog({ visible, close }: { visible: boolean; close: () => void }) {
  const router = useRouter();
  const { addBodyWeightEntry } = useHealth();
  const [weightMode, setWeightMode] = useState(false);
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const dismiss = () => { if (lock.current) return; setWeightMode(false); setError(null); close(); };
  const navigate = (href: Href) => { dismiss(); router.push(href); };
  const save = async () => {
    if (lock.current) return;
    const parsed = Number(weight.trim());
    if (!weight.trim() || !finite(parsed) || parsed <= 0 || parsed > 2000) { setError('Enter a valid weight in pounds.'); return; }
    lock.current = true; setSaving(true); setError(null);
    try {
      await addBodyWeightEntry({ date: localIsoTimestamp(), weightLbs: parsed, source: 'manual', ...(notes.trim() ? { notes: notes.trim() } : {}) });
      setWeight(''); setNotes(''); setWeightMode(false); close();
    } catch { setError('Weight was not confirmed as saved. Check the connection and your entries before trying again.'); }
    finally { lock.current = false; setSaving(false); }
  };
  return <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
    <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss quick log" style={styles.scrim} onPress={dismiss} />
      <SafeAreaView style={styles.sheet} edges={['bottom']} accessibilityViewIsModal>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <View style={styles.row}><Text style={[styles.sectionTitle, styles.flex]}>{weightMode ? 'Log body weight' : 'Add to your day'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close quick log" onPress={dismiss} style={styles.iconButton}><Ionicons name="close" size={24} color={C.text} /></Pressable></View>
          {weightMode ? <>
            <Text style={styles.body}>Weight in pounds</Text>
            <TextInput accessibilityLabel="Weight in pounds" autoFocus keyboardType="decimal-pad" editable={!saving} value={weight} onChangeText={setWeight} placeholder="0.0" placeholderTextColor={C.textMuted} style={styles.input} />
            <TextInput accessibilityLabel="Optional weigh-in note" editable={!saving} value={notes} onChangeText={setNotes} placeholder="Optional note" placeholderTextColor={C.textMuted} style={styles.input} />
            <Notice error={error} />
            <Button title={saving ? 'Saving…' : 'Save weight'} onPress={() => void save()} disabled={saving} />
            <Button title="Back" secondary disabled={saving} onPress={() => setWeightMode(false)} />
          </> : <>
            <Body muted>Log an action. Keep the bigger picture.</Body>
            {([
              ['barbell-outline', 'Workout', 'Sets, cardio, effort and session notes', () => navigate('/workout')],
              ['restaurant-outline', 'Food', 'Your food diary and saved quick-add meals', () => navigate('/nutrition')],
              ['scale-outline', 'Weight', 'Add a measurement, not a judgment', () => setWeightMode(true)],
            ] as const).map(([icon, title, subtitle, action]) => <Pressable key={title} accessibilityRole="button" onPress={action} style={styles.logAction}><Ionicons name={icon} size={25} color={C.primary} /><View style={styles.flex}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.caption}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={18} color={C.textMuted} /></Pressable>)}
          </>}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
export function Screen({ title, subtitle, children, onRefresh, refreshing = false, loading = false }: { title: string; subtitle?: string; children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; loading?: boolean }) {
  const [quickLog, setQuickLog] = useState(false);
  const router = useRouter();
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <View style={[styles.row, styles.flex]}><BaselineMark size={38} /><View style={styles.flex}><Text style={styles.wordmark}>Gain<Text style={{ color: C.primary }}>Log</Text></Text><Text style={styles.tagline}>BUILD YOUR HEALTHSPAN</Text></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Quick log" style={styles.addButton} onPress={() => setQuickLog(true)}><Ionicons name="add" size={25} color={C.background} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open settings" style={styles.iconButton} onPress={() => router.push('/settings')}><Ionicons name="settings-outline" size={22} color={C.textSecondary} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} /> : undefined}>
      <View style={styles.titleBlock}><Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>
      {loading ? <View accessibilityLabel="Loading saved data" style={styles.loading}><ActivityIndicator color={C.primary} /><Body muted>Reading your saved data…</Body></View> : children}
    </ScrollView>
    <QuickLog visible={quickLog} close={() => setQuickLog(false)} />
  </SafeAreaView>;
}
export function Stat({ label: title, value, unit, detail }: { label: string; value: string; unit?: string; detail?: string }) {
  return <View style={styles.stat}><Eyebrow>{title}</Eyebrow><Text style={styles.statValue}>{value}{unit ? <Text style={styles.unit}> {unit}</Text> : null}</Text>{detail && <Text style={styles.caption}>{detail}</Text>}</View>;
}
export function Sparkline({ window }: { window: TrendWindow }) {
  const geometry = sparklineGeometry(window.points, shiftDay(localDay(), -1));
  return <View accessible accessibilityLabel={`28-day trend, ${window.points.length} observed days. Missing days are gaps.`}>
    <Svg width="100%" height={64} viewBox="0 0 240 60"><Path d="M0 57 H240" stroke={C.divider} /><Path d={geometry.path} fill="none" stroke={C.primary} strokeWidth={2} strokeLinecap="round" />{geometry.dots.map((point, i) => <Circle key={i} cx={point.x} cy={point.y} r={2} fill={C.primary} />)}</Svg>
  </View>;
}
export function TrendTile({ title, window, unit, href, duration = false }: { title: string; window: TrendWindow; unit: string; href: Href; duration?: boolean }) {
  const router = useRouter();
  const value = window.recent == null ? '—' : duration ? `${Math.floor(Math.round(window.recent) / 60)}h ${Math.round(window.recent) % 60}m` : numberLabel(window.recent, unit === 'steps' ? 0 : 1);
  const comparison = window.mixedSources ? 'Source changed · compare with care' : window.delta == null ? 'Building comparison history' : `${window.delta >= 0 ? '+' : '−'}${numberLabel(Math.abs(window.delta), 1)} ${unit} vs prior 28 days`;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${value} ${duration ? '' : unit}. ${comparison}. View trends.`} onPress={() => router.push(href)} style={({ pressed }) => [styles.trendTile, pressed && { opacity: 0.7 }]}>
    <View style={styles.row}><Text style={[styles.linkTitle, styles.flex]}>{title}</Text><Ionicons name="arrow-forward" size={17} color={C.textMuted} /></View>
    <Text style={styles.trendValue}>{value}{!duration && <Text style={styles.unit}> {unit}</Text>}</Text>
    <Sparkline window={window} />
    <Text style={styles.caption}>{comparison}</Text>
    <Text style={styles.caption}>{window.observed}/7 completed days observed</Text>
  </Pressable>;
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', maxWidth: 960, alignSelf: 'center' },
  wordmark: { fontSize: 23, fontWeight: '800', letterSpacing: -0.7, color: C.text },
  tagline: { fontSize: 10, letterSpacing: 1, color: C.textMuted, fontWeight: '600', marginTop: 2 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingTop: 10, paddingBottom: 32, gap: 16, width: '100%', maxWidth: 960, alignSelf: 'center' },
  titleBlock: { gap: 5, paddingVertical: 4 }, pageTitle: { color: C.text, fontSize: 32, fontWeight: '700', letterSpacing: -1 },
  subtitle: { color: C.textSecondary, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: C.surface, borderColor: C.divider, borderWidth: 1, borderRadius: 24, padding: 20, gap: 12 },
  body: { color: C.textSecondary, fontSize: 14, lineHeight: 22 },
  eyebrow: { color: C.textMuted, fontSize: 11, letterSpacing: 1, fontWeight: '700', textTransform: 'uppercase' },
  sectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: C.text },
  caption: { fontSize: 12, lineHeight: 18, color: C.textMuted },
  button: { minHeight: 48, borderRadius: 15, backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryButton: { backgroundColor: C.elevated, borderColor: C.divider, borderWidth: 1 },
  buttonText: { color: C.background, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  link: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 52, paddingVertical: 6 },
  linkTitle: { color: C.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  notice: { backgroundColor: C.elevated, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: C.divider },
  loading: { minHeight: 250, justifyContent: 'center', alignItems: 'center', gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flex: 1, minWidth: 100, gap: 8 }, statValue: { color: C.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  unit: { fontSize: 13, letterSpacing: 0, color: C.textSecondary, fontWeight: '400' },
  trendTile: { minWidth: 140, flexBasis: '46%', flexGrow: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, borderRadius: 22, padding: 16, gap: 6 },
  trendValue: { fontSize: 29, fontWeight: '700', letterSpacing: -0.8, color: C.text, marginTop: 8, fontVariant: ['tabular-nums'] },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.divider, width: '100%', maxWidth: 640, maxHeight: '90%', alignSelf: 'center' },
  sheetContent: { padding: 22, gap: 16 }, logAction: { minHeight: 78, flexDirection: 'row', gap: 16, alignItems: 'center' },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: C.divider, color: C.text, padding: 12, fontSize: 17, backgroundColor: C.background },
});
