import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { API_URL } from '../constants/api';

type Row = { key: string; label: string; value: string | number | null; target: string; status: 'green' | 'amber' | 'red'; observations: number; note: string };
type Card = { weekStart: string; weekEnd: string; partialWeek: boolean; completedDays: number; rows: Row[]; oneChange: string; savedAt: string | null };
const colors = { green: '#62C9AC', amber: '#F1C46A', red: '#FF9E92' };
function monday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key: string) => parts.find(p => p.type === key)?.value;
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export default function WeeklyScorecard() {
  const [week, setWeek] = useState(monday), [draft, setDraft] = useState(monday);
  const [card, setCard] = useState<Card | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch(`${API_URL}/longevity/scorecard?weekStart=${encodeURIComponent(week)}`);
    if (!response.ok) throw new Error('Choose a non-future Monday (YYYY-MM-DD).');
    setCard(await response.json());
  }, [week]);
  useEffect(() => { setCard(null); setError(''); void refresh().catch(e => setError(String(e))); }, [refresh]);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${API_URL}/longevity/scorecard/save?weekStart=${encodeURIComponent(week)}`, { method: 'POST' });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      await response.json(); await refresh(); setNotice('Snapshot saved with the weekly review. Existing review prose is preserved.');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <View style={{ padding: 16, backgroundColor: '#17232C', borderRadius: 14, gap: 10 }}>
    <Text style={{ color: '#EAF1F4', fontSize: 20, fontWeight: '700' }}>Weekly longevity scorecard</Text>
    <Text style={{ color: '#B3C2CB' }}>Monday–Sunday · Eastern. Missing evidence is amber, not a healthy zero. Averages exclude today; nutrition averages require full-day confirmation.</Text>
    <TextInput accessibilityLabel="Scorecard Monday YYYY-MM-DD" value={draft} onChangeText={setDraft} style={{ color: 'white', borderWidth: 1, borderColor: '#627580', padding: 10, borderRadius: 8 }} />
    <Pressable accessibilityRole="button" onPress={() => { setWeek(draft); setNotice(''); }} style={{ padding: 12, backgroundColor: '#247D82', borderRadius: 8 }}><Text style={{ color: 'white' }}>Load week</Text></Pressable>
    {card && <>
      <Text style={{ color: '#B3C2CB' }}>{card.weekStart} → {card.weekEnd} · {card.partialWeek ? 'Week in progress' : 'Completed week'} · {card.completedDays} completed calendar days</Text>
      {card.rows.map(row => <View key={row.key} style={{ borderLeftWidth: 4, borderColor: colors[row.status], paddingLeft: 10, paddingVertical: 7 }}>
        <Text style={{ color: '#EAF1F4', fontWeight: '600' }}>{row.label}: {row.value ?? '—'} · {row.status}</Text>
        <Text style={{ color: '#B3C2CB' }}>Target {row.target} · {row.observations} observations{row.note ? ` · ${row.note}` : ''}</Text>
      </View>)}
      <Text style={{ color: '#62C9AC', fontWeight: '600' }}>One next step</Text>
      <Text style={{ color: '#EAF1F4' }}>{card.oneChange}</Text>
      <Text style={{ color: '#B3C2CB' }}>Rule-based suggestion from this scorecard; not a diagnosis. Saved snapshot: {card.savedAt ?? 'not saved'}.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={{ padding: 12, backgroundColor: '#247D82', borderRadius: 8, opacity: busy ? .5 : 1 }}><Text style={{ color: 'white' }}>{busy ? 'Saving…' : 'Save weekly snapshot'}</Text></Pressable>
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FF9E92' }}>{error}</Text>}
    {!!notice && <Text style={{ color: '#62C9AC' }}>{notice}</Text>}
  </View>;
}
