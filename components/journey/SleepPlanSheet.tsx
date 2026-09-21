import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { useJourney } from '../../context/JourneyContext';
import { sleepPlan } from '../../utils/dayJourney';
import { Sheet } from '../v2/ui';
import { Button, j } from './primitives';

export function SleepPlanSheet({ onClose }: { onClose: () => void }) {
  const journey = useJourney();
  const [draftRevision] = useState(journey.preferences.revision);
  const staleDraft = journey.preferences.revision !== draftRevision;
  const [wakeTime, setWake] = useState(journey.preferences.wakeTime ?? '');
  const [hours, setHours] = useState(journey.preferences.sleepMinutes ? String(journey.preferences.sleepMinutes / 60) : '');
  const [windDown, setWindDown] = useState(String(journey.preferences.windDownMinutes));
  const [error, setError] = useState<string | null>(null);
  const minutes = Math.round(Number(hours) * 60), wind = Number(windDown);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(wakeTime) && hours.trim() !== '' && Number.isFinite(minutes) && minutes >= 300 && minutes <= 660 && windDown.trim() !== '' && Number.isInteger(wind) && wind >= 0 && wind <= 120;
  const plan = valid ? sleepPlan({ ...journey.preferences, wakeTime, sleepMinutes: minutes, windDownMinutes: wind }) : null;
  const save = async (clear = false) => {
    try { await journey.savePreferences(clear ? { wakeTime: null, sleepMinutes: null } : { wakeTime, sleepMinutes: minutes, windDownMinutes: wind }, draftRevision); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Not saved.'); }
  };
  return <Sheet visible title="Plan tonight" onClose={() => { if (!journey.busy) onClose(); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 16 }}>
    <Text style={j.body}>Choose your own sleep opportunity. This is a planning window, not a prediction of how much you will sleep.</Text>
    <Text style={j.heading}>Wake time · 24-hour clock</Text><TextInput editable={!journey.busy} style={j.input} accessibilityLabel="Wake time, HH colon MM" placeholder="06:30" placeholderTextColor="#9BA8B6" value={wakeTime} onChangeText={setWake} maxLength={5} keyboardType="numbers-and-punctuation" />
    <Text style={j.heading}>Time in bed · hours</Text><TextInput editable={!journey.busy} style={j.input} accessibilityLabel="Chosen time in bed in hours" placeholder="Choose 5–11 hours" placeholderTextColor="#9BA8B6" value={hours} onChangeText={setHours} keyboardType="decimal-pad" maxLength={4} />
    <Text style={j.heading}>Wind-down lead time · minutes</Text><TextInput editable={!journey.busy} style={j.input} accessibilityLabel="Wind-down minutes" value={windDown} onChangeText={setWindDown} keyboardType="number-pad" maxLength={3} />
    {plan && <View style={j.hero}><Text style={j.eyebrow}>Your chosen rhythm</Text><Text style={j.heading}>Wind down {plan.windDown}</Text><Text style={j.title}>{plan.bedtime} → {plan.wake}</Text><Text style={j.body}>{plan.opportunity} of planned time in bed</Text></View>}
    {(error || journey.error || staleDraft) && <Text style={j.body} accessibilityLiveRegion="polite">{error ?? journey.error ?? 'The saved plan changed. Close and reopen this editor before saving.'}</Text>}
    <Button title={journey.busy ? 'Saving…' : 'Save my sleep plan'} onPress={() => void save()} disabled={!valid || !journey.snapshot || journey.busy || journey.loading || !!journey.error || staleDraft} />
    {journey.preferences.wakeTime && <Button secondary title="Remove this sleep plan" disabled={journey.busy || journey.loading || !!journey.error || staleDraft} onPress={() => void save(true)} />}
    <Text style={j.note}>Local clock times; daylight-saving changes can alter elapsed hours. This saves a recurring plan, not an alarm or notification.</Text>
  </KeyboardAvoidingView></Sheet>;
}
