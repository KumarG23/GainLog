import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { API_URL } from '../constants/api';
import { importBloodPressure, writeBloodPressure } from '../utils/longevityHealthConnect';
import SupplementChecklist from '../components/SupplementChecklist';

type Reading = { id: string; pairId: string | null; day: string; time: string; systolic: number; diastolic: number; pulse: number | null; arm: string | null; position: string | null; source: string };
type BP = { readings: Reading[]; average7: { systolic: number | null; diastolic: number | null; sessions: number }; average30: { systolic: number | null; diastolic: number | null; sessions: number } };
type Night = { day: string; hours: number; ahi: number; leakLpm: number | null; maskOffCount: number | null };
type CPAP = { nights: Night[]; summary30: { observedNights: number; nights4h: number; nights6h: number; percent4h: number; percent6h: number; averageAhi: number | null; averageHours: number | null } };
type Draft = { time: string; systolic: number; diastolic: number; pulse: number | null; arm: 'left' | 'right'; position: 'sitting' | 'standing' | 'lying' | 'reclining' };
const panel = { padding: 16, backgroundColor: '#17232C', borderRadius: 14, gap: 10 } as const;
const label = { color: '#EAF1F4', fontSize: 17 } as const;
const muted = { color: '#B3C2CB', fontSize: 14 } as const;
const field = { borderWidth: 1, borderColor: '#627580', padding: 10, borderRadius: 8, color: '#FFFFFF', minWidth: 70, flexGrow: 1 } as const;
function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ padding: 12, borderRadius: 8, backgroundColor: disabled ? '#46545A' : '#247D82' }}><Text style={{ color: 'white', fontWeight: '700' }}>{title}</Text></Pressable>; }
function Entry({ title, value, onChangeText, decimal = false }: { title: string; value: string; onChangeText: (v: string) => void; decimal?: boolean }) { return <View style={{ flex: 1 }}><Text style={muted}>{title}</Text><TextInput accessibilityLabel={title} style={field} keyboardType={decimal ? 'decimal-pad' : 'number-pad'} value={value} onChangeText={onChangeText} placeholder="—" placeholderTextColor="#B3C2CB" /></View>; }
async function api<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${API_URL}/longevity${path}`, init); if (!response.ok) { let detail = `Request failed (${response.status})`; try { const body = await response.json(); if (typeof body.detail === 'string') detail = body.detail; } catch {} throw new Error(detail); } return response.json(); }
function localDay() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
const fmt = (value: number | null) => value == null ? '—' : String(value);

export default function Longevity() {
  const [bp, setBp] = useState<BP | null>(null), [cpap, setCpap] = useState<CPAP | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [sys, setSys] = useState(''), [dia, setDia] = useState(''), [pulse, setPulse] = useState('');
  const [arm, setArm] = useState<'left' | 'right'>('left'), [position, setPosition] = useState<Draft['position']>('sitting');
  const [first, setFirst] = useState<Draft | null>(null);
  const [day, setDay] = useState(localDay()), [hours, setHours] = useState(''), [ahi, setAhi] = useState(''), [leak, setLeak] = useState(''), [mask, setMask] = useState('');
  const refresh = useCallback(async () => { const [b, c] = await Promise.all([api<BP>('/bp'), api<CPAP>('/cpap')]); setBp(b); setCpap(c); }, []);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await task(); await refresh(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  function draft(): Draft | null { const s = Number(sys), d = Number(dia), p = pulse.trim() ? Number(pulse) : null; if (!sys || !dia || !Number.isInteger(s) || !Number.isInteger(d) || s < 60 || s > 300 || d < 30 || d > 200 || s <= d || p != null && (!Number.isInteger(p) || p < 25 || p > 240)) { setError('Enter valid systolic (60–300), diastolic (30–200) and optional pulse (25–240).'); return null; } return { time: new Date().toISOString(), systolic: s, diastolic: d, pulse: p, arm, position }; }
  function saveReading() { const reading = draft(); if (!reading) return; if (!first) { setFirst(reading); setSys(''); setDia(''); setPulse(''); setError(''); setNotice('First reading captured. Wait one minute, then enter the second reading.'); return; }
    const elapsed = (Date.parse(reading.time) - Date.parse(first.time))/1000;
    if (elapsed < 45 || elapsed > 180) { setError(elapsed < 45 ? 'Wait at least 45 seconds after the first reading.' : 'More than 3 minutes elapsed. Start a new pair.'); return; }
    void run(async () => { const readings = [first, reading]; await api('/bp/pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readings }) }); setFirst(null); setSys(''); setDia(''); setPulse(''); setNotice('Pair saved.'); if (Platform.OS === 'android') { try { await writeBloodPressure(readings); } catch (e) { setNotice(`Saved in GainLog; Health Connect write unavailable: ${e instanceof Error ? e.message : String(e)}`); } } });
  }
  function saveCpap() { const h = Number(hours), a = Number(ahi), l = leak.trim() ? Number(leak) : null, m = mask.trim() ? Number(mask) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || !hours.trim() || !ahi.trim() || !Number.isFinite(h) || h < 0 || h > 24 || !Number.isFinite(a) || a < 0 || a > 150 || l != null && (!Number.isFinite(l) || l < 0 || l > 200) || m != null && (!Number.isInteger(m) || m < 0 || m > 100)) { setError('Enter a valid date, hours (0–24), AHI (0–150), and optional leak/mask count.'); return; }
    void run(async () => { await api(`/cpap/${day}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, hours: h, ahi: a, leakLpm: l, maskOffCount: m }) }); setNotice('CPAP night saved.'); });
  }
  return <ScrollView style={{ flex: 1, backgroundColor: '#0B1118' }} contentContainerStyle={{ padding: 18, gap: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
    <Text style={{ color: 'white', fontSize: 27, fontWeight: '700' }}>Longevity log</Text>
    <Text style={muted}>Private records in GainLog. Missing nights and readings are not zero measurements.</Text>
    {busy && <ActivityIndicator />}{!!error && <Text accessibilityRole="alert" style={{ color: '#FF9E92' }}>{error}</Text>}{!!notice && <Text style={muted}>{notice}</Text>}
    <View style={panel}><Text style={label}>Blood pressure · two readings</Text><Text style={muted}>Sit quietly, measure twice about one minute apart. Target &lt;120/80. Check Tuesday and Saturday mornings.</Text>
      <Text style={muted}>7 days: {fmt(bp?.average7.systolic ?? null)}/{fmt(bp?.average7.diastolic ?? null)} ({bp?.average7.sessions ?? 0} sessions) · 30 days: {fmt(bp?.average30.systolic ?? null)}/{fmt(bp?.average30.diastolic ?? null)} ({bp?.average30.sessions ?? 0} sessions)</Text>
      <Text style={muted}>{first ? `First captured ${new Date(first.time).toLocaleTimeString()} · ${first.systolic}/${first.diastolic}` : 'First reading'}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}><Entry title="Systolic" value={sys} onChangeText={setSys} /><Entry title="Diastolic" value={dia} onChangeText={setDia} /><Entry title="Pulse" value={pulse} onChangeText={setPulse} /></View>
      <View style={{ flexDirection: 'row', gap: 8 }}><Button title={`Arm: ${arm}`} onPress={() => setArm(arm === 'left' ? 'right' : 'left')} /><Button title={`Position: ${position}`} onPress={() => setPosition(position === 'sitting' ? 'standing' : position === 'standing' ? 'lying' : position === 'lying' ? 'reclining' : 'sitting')} /></View>
      <Button title={first ? 'Save second reading & pair' : 'Capture first reading'} onPress={saveReading} disabled={busy} />{first && <Button title="Start pair over" onPress={() => { setFirst(null); setError(''); }} disabled={busy} />}
      {Platform.OS === 'android' && <Button title="Import BP from Health Connect (30 days)" disabled={busy} onPress={() => void run(async () => { const count = await importBloodPressure(); setNotice(`Processed ${count} Health Connect readings.`); })} />}
      {bp?.readings.slice(0, 12).map(r => <Text key={r.id} style={muted}>{new Date(r.time).toLocaleString()} · {r.systolic}/{r.diastolic}{r.pulse == null ? '' : ` · pulse ${r.pulse}`} · {r.arm ?? 'arm unreported'} · {r.position ?? 'position unreported'} · {r.source}</Text>)}
    </View>
    <View style={panel}><Text style={label}>CPAP · nightly report</Text><Text style={muted}>Last 30 calendar nights: ≥4 h {cpap?.summary30.percent4h == null ? '—' : `${cpap.summary30.percent4h}%`} · ≥6 h {cpap?.summary30.percent6h == null ? '—' : `${cpap.summary30.percent6h}%`} ({cpap?.summary30.nights6h ?? 0}/30). Observed: {cpap?.summary30.observedNights ?? 0}/30; average AHI {fmt(cpap?.summary30.averageAhi ?? null)} over observed nights.</Text>
      <Text style={muted}>Enter the therapy night date shown in your CPAP report. Re-saving the same date corrects that night.</Text>
      <TextInput accessibilityLabel="Therapy date YYYY-MM-DD" style={field} value={day} onChangeText={setDay} /><View style={{ flexDirection: 'row', gap: 8 }}><Entry title="Usage hours" value={hours} onChangeText={setHours} decimal /><Entry title="AHI" value={ahi} onChangeText={setAhi} decimal /></View>
      <View style={{ flexDirection: 'row', gap: 8 }}><Entry title="95th-percentile leak L/min (optional)" value={leak} onChangeText={setLeak} decimal /><Entry title="Mask on/off count (optional)" value={mask} onChangeText={setMask} /></View>
      <Button title="Save CPAP night" onPress={saveCpap} disabled={busy} />
      {cpap?.nights.slice(0, 14).map(n => <Pressable key={n.day} accessibilityRole="button" onPress={() => { setDay(n.day); setHours(String(n.hours)); setAhi(String(n.ahi)); setLeak(n.leakLpm == null ? '' : String(n.leakLpm)); setMask(n.maskOffCount == null ? '' : String(n.maskOffCount)); }}><Text style={muted}>{n.day} · {n.hours} h · AHI {n.ahi} · leak {n.leakLpm ?? '—'} · mask on/off {n.maskOffCount ?? '—'} (tap to edit)</Text></Pressable>)}
    </View>
    <SupplementChecklist />
  </ScrollView>;
}
