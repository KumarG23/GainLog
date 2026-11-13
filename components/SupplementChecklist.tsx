import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { API_URL } from '../constants/api';
import { localDateKey } from '../utils/date';

type Item = { id: string; name: string; dose: string; period: 'AM' | 'PM'; taken: boolean };
type Summary = { items: Item[]; adherence7: number | null; taken7: number; scheduled7: number };
const color = '#EAF1F4';
const muted = '#B3C2CB';
const button = { padding: 11, borderRadius: 8, backgroundColor: '#247D82' } as const;
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/longevity/supplements${path}`, init);
  if (!response.ok) throw new Error(`Supplement request failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json();
}
export default function SupplementChecklist() {
  const [data, setData] = useState<Summary | null>(null);
  const [name, setName] = useState(''), [dose, setDose] = useState('');
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const day = localDateKey();
  const refresh = useCallback(async () => { setData(await api<Summary>(`?day=${day}`)); }, [day]);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await task(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const body = () => JSON.stringify({ name: name.trim(), dose: dose.trim(), period });
  const headers = { 'Content-Type': 'application/json' };
  return <View style={{ padding: 16, backgroundColor: '#17232C', borderRadius: 14, gap: 10 }}>
    <Text style={{ color, fontSize: 18, fontWeight: '700' }}>Supplements · AM / PM</Text>
    <Text style={{ color: muted }}>7-day adherence: {data?.adherence7 == null ? '— (no schedule)' : `${data.adherence7}% (${data.taken7}/${data.scheduled7} scheduled doses)`}. Configure your own list; nothing is preloaded.</Text>
    {(['AM', 'PM'] as const).map(slot => <View key={slot} style={{ gap: 6 }}>
      <Text style={{ color, fontWeight: '700' }}>{slot}</Text>
      {data?.items.filter(item => item.period === slot).map(item => <View key={item.id} style={{ gap: 5, borderTopWidth: 1, borderColor: '#384B55', paddingTop: 7 }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.name} ${item.dose} taken today`} accessibilityState={{ checked: item.taken, disabled: busy }} disabled={busy}
          onPress={() => void run(() => api(`/${encodeURIComponent(item.id)}/taken/${day}`, { method: 'PUT', headers, body: JSON.stringify({ taken: !item.taken }) }))}>
          <Text style={{ color, fontSize: 16 }}>{item.taken ? '☑' : '☐'} {item.name} · {item.dose}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEditing(item.id); setName(item.name); setDose(item.dose); setPeriod(item.period); }}><Text style={{ color: '#62C9AC' }}>Edit</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => api(`/${encodeURIComponent(item.id)}`, { method: 'DELETE' }))}><Text style={{ color: '#FF9E92' }}>Archive</Text></Pressable>
        </View>
      </View>)}
    </View>)}
    <Text style={{ color: muted }}>{editing ? 'Edit supplement' : 'Add supplement'} · name and dose</Text>
    <TextInput accessibilityLabel="Supplement name" placeholder="Name" placeholderTextColor={muted} value={name} onChangeText={setName} style={{ color, borderColor: '#627580', borderWidth: 1, padding: 10, borderRadius: 8 }} />
    <TextInput accessibilityLabel="Supplement dose" placeholder="Dose" placeholderTextColor={muted} value={dose} onChangeText={setDose} style={{ color, borderColor: '#627580', borderWidth: 1, padding: 10, borderRadius: 8 }} />
    <View style={{ flexDirection: 'row', gap: 8 }}>{(['AM','PM'] as const).map(slot => <Pressable accessibilityRole="radio" accessibilityState={{ selected: period === slot }} key={slot} onPress={() => setPeriod(slot)} style={[button, { opacity: period === slot ? 1 : .5 }]}><Text style={{ color }}>{slot}</Text></Pressable>)}</View>
    <Pressable accessibilityRole="button" disabled={busy || !name.trim() || !dose.trim()} style={[button, { opacity: busy || !name.trim() || !dose.trim() ? .5 : 1 }]} onPress={() => void run(async () => { await api(editing ? `/${editing}` : '', { method: editing ? 'PUT' : 'POST', headers, body: body() }); setEditing(null); setName(''); setDose(''); })}><Text style={{ color }}>{editing ? 'Save changes' : 'Add to checklist'}</Text></Pressable>
    {editing && <Pressable accessibilityRole="button" onPress={() => { setEditing(null); setName(''); setDose(''); }}><Text style={{ color: muted }}>Cancel edit</Text></Pressable>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FF9E92' }}>{error}</Text>}
  </View>;
}
