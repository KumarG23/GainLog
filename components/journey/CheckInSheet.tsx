import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { useJourney } from '../../context/JourneyContext';
import type { CheckInPatch, DayCheckIn } from '../../types/journey';
import { dayKey } from '../../utils/healthspan';
import { Sheet } from '../v2/ui';
import { Button, Choice, j } from './primitives';

export function CheckInSheet({ initial, mode = 'checkin', onClose, stressMinute }: { initial: DayCheckIn; mode?: 'checkin' | 'reflection'; onClose: () => void; stressMinute?: number }) {
  const journey = useJourney();
  const [draft, setDraft] = useState<CheckInPatch>({ energy: initial.energy, soreness: initial.soreness, stress: initial.stress, note: initial.note, trainingIntent: initial.trainingIntent, reflection: initial.reflection, stressMinute: stressMinute ?? initial.stressMinute });
  const [error, setError] = useState<string | null>(null), [confirmDelete, setConfirmDelete] = useState(false);
  const [openedOn] = useState(dayKey(journey.now));
  const changedDay = openedOn !== dayKey(journey.now);
  const save = async () => {
    if (changedDay) { setError('The day changed. Close this sheet and open today’s check-in.'); return; }
    const patch: CheckInPatch = mode === 'reflection' ? { reflection: draft.reflection?.trim() || null } : { energy: draft.energy, soreness: draft.soreness, stress: draft.stress, trainingIntent: draft.trainingIntent, note: draft.note?.trim() || null, stressMinute: draft.stressMinute };
    try { await journey.saveDay(initial.date, patch); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Not saved.'); }
  };
  return <Sheet visible title={mode === 'reflection' ? 'Close the day' : 'How do you feel?'} onClose={() => { if (!journey.busy) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 18 }}>
      <Text style={j.note}>{initial.date}</Text>
      <Text style={j.body}>{mode === 'reflection' ? 'One thing that worked, or something to remember tomorrow. This stays with your day.' : 'Your perspective belongs beside the wearable. All answers are optional; no score or target changes automatically.'}</Text>
      {mode === 'checkin' && <>
        {(['energy', 'soreness', 'stress'] as const).map(key => <View key={key} style={{ gap: 8 }}><Text style={j.heading}>{key === 'stress' ? 'Perceived stress' : key.charAt(0).toUpperCase() + key.slice(1)}</Text><View style={j.row} accessibilityRole="radiogroup">{[1, 2, 3, 4, 5].map(value => <Choice key={value} label={String(value)} selected={draft[key] === value} disabled={journey.busy} onPress={() => setDraft(v => ({ ...v, [key]: v[key] === value ? null : value }))} />)}</View><Text style={j.note}>{key === 'energy' ? '1 = very low · 5 = high energy' : key === 'soreness' ? '1 = none · 5 = very sore' : '1 = calm · 5 = very stressed'}</Text></View>)}
        <Text style={j.heading}>Today’s intention</Text><View style={j.row}><Choice label="Review my plan" selected={draft.trainingIntent === 'plan'} onPress={() => setDraft(v => ({ ...v, trainingIntent: v.trainingIntent === 'plan' ? null : 'plan' }))} /><Choice label="Rest day" selected={draft.trainingIntent === 'rest'} onPress={() => setDraft(v => ({ ...v, trainingIntent: v.trainingIntent === 'rest' ? null : 'rest' }))} /></View>
        <TextInput accessibilityLabel="Optional check-in note" placeholder="Anything a sensor would miss? (optional)" placeholderTextColor="#9BA8B6" value={draft.note ?? ''} onChangeText={note => setDraft(v => ({ ...v, note }))} maxLength={400} multiline style={[j.input, { minHeight: 88 }]} editable={!journey.busy} />
        {draft.stressMinute != null && <Text style={j.note}>Note linked to {String(Math.floor(draft.stressMinute / 60)).padStart(2, '0')}:{String(draft.stressMinute % 60).padStart(2, '0')} on this day. This does not label that period’s cause.</Text>}
      </>}
      {mode === 'reflection' && <TextInput accessibilityLabel="Evening reflection" placeholder="What would you like to remember?" placeholderTextColor="#9BA8B6" value={draft.reflection ?? ''} onChangeText={reflection => setDraft(v => ({ ...v, reflection }))} maxLength={400} multiline style={[j.input, { minHeight: 120 }]} editable={!journey.busy} />}
      {(error || journey.error) && <View style={j.error}><Text style={j.body}>{error ?? journey.error}</Text><Button secondary title="Refresh saved entries" onPress={() => { void journey.refresh(); setError(null); }} disabled={journey.busy} /></View>}
      <Button title={journey.busy ? 'Saving…' : 'Save to my day'} onPress={() => void save()} disabled={!journey.snapshot || journey.busy || !!journey.error || changedDay} />
      {initial.revision > 0 && <Button secondary title={confirmDelete ? 'Confirm: clear today’s check-in & reflection' : 'Clear my entry for this day'} disabled={journey.busy || !!journey.error} onPress={() => { if (!confirmDelete) { setConfirmDelete(true); return; } void journey.clearDay(initial.date).then(onClose).catch(e => setError(e.message)); }} />}
      <Text style={j.note}>Saved to your private GainLog backend. Nothing is sent to an AI model or wearable provider.</Text>
    </KeyboardAvoidingView>
  </Sheet>;
}
