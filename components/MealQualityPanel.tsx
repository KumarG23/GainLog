import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { API_URL } from '../constants/api';
import { useHealth } from '../context/HealthContext';
import { localDateKey } from '../utils/date';
import type { MealQualityTag, NutritionEntry } from '../types/health';

const TAGS: MealQualityTag[] = ['ultra-processed', 'fatty-fish', 'EVOO', 'home-cooked'];
const color = '#EAF1F4';
const muted = '#B3C2CB';
function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/nutrition${path}`, init);
  if (!response.ok) throw new Error(`Meal quality request failed (${response.status})`);
  return response.json();
}
type Counts = { upfDinners: number | null; fattyFishMeals: number | null; daysLogged: number | null };
export default function MealQualityPanel({ entries }: { entries: NutritionEntry[] }) {
  const { setNutritionTags } = useHealth();
  const today = localDateKey();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [fullDay, setFullDay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const [week, day] = await Promise.all([
      request<Counts>(`/quality/week?weekStart=${weekStart(today)}`),
      request<{ confirmed: boolean }>(`/full-day/${today}`),
    ]);
    setCounts(week); setFullDay(day.confirmed);
  }, [today]);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh, entries]);
  async function change(task: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await task(); await refresh(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <View style={{ padding: 16, gap: 10, borderRadius: 12, backgroundColor: '#17232C' }}>
    <Text style={{ color, fontSize: 18, fontWeight: '700' }}>Meal quality · confirmed tags</Text>
    <Text style={{ color: muted }}>This week (Mon–Sun): UPF dinners {counts?.upfDinners ?? '—'} · fatty-fish meals {counts?.fattyFishMeals ?? '—'} · fully logged days {counts?.daysLogged ?? '—'}/7. Blank means unobserved.</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void change(async () => {
      await request(`/full-day/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: !fullDay }) });
      setFullDay(!fullDay);
    })} style={{ padding: 12, backgroundColor: '#247D82', borderRadius: 8 }}>
      <Text style={{ color, fontWeight: '700' }}>{fullDay ? '✓ Day fully logged (tap to undo)' : 'Confirm today is fully logged'}</Text>
    </Pressable>
    <Text style={{ color: muted }}>Tag only what you can confirm. Fast-food, pizza and chips may be ultra-processed; suggestions never save themselves.</Text>
    {entries.map(entry => {
      const suggestion = /\b(pizza|chips|fries|burger|fast.food)\b/i.test(entry.name) && !(entry.tags ?? []).includes('ultra-processed');
      return <View key={entry.id} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderColor: '#384B55' }}>
        <Text style={{ color, fontWeight: '600' }}>{entry.meal}: {entry.name}</Text>
        {suggestion && <Text style={{ color: muted }}>Suggested: ultra-processed? Confirm below only if accurate.</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {TAGS.map(tag => {
            const selected = (entry.tags ?? []).includes(tag);
            return <Pressable key={tag} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} accessibilityLabel={`${tag} for ${entry.name}`} disabled={busy}
              onPress={() => void change(() => setNutritionTags(entry.id, selected ? (entry.tags ?? []).filter(t => t !== tag) : [...(entry.tags ?? []), tag]))}
              style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: selected ? '#62C9AC' : '#627580' }}><Text style={{ color }}>{selected ? '✓ ' : ''}{tag}</Text></Pressable>;
          })}
        </View>
      </View>;
    })}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FF9E92' }}>{error}</Text>}
  </View>;
}
