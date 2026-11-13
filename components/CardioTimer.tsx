import React, { useEffect, useState } from 'react';
import { Alert, AppState, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing } from '../constants/theme';
import { CardioTiming, elapsedCardioSeconds, formatElapsed, isCardioRunning, parseLocalCardioClock, startCardio, stopCardio } from '../utils/cardioTimer';

type TimingPatch = Partial<CardioTiming>;

function localParts(iso?: string): [string, string] {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ['', ''];
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, `${pad(date.getHours())}:${pad(date.getMinutes())}`];
}

export function CardioTimer({ timing, onChange }: { timing: CardioTiming; onChange: (patch: TimingPatch) => void }) {
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const running = isCardioRunning(timing);
  const finished = Boolean(timing.cardioStartedAt && timing.cardioEndedAt);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setNow(Date.now());
    });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [running]);

  const confirmRestart = () => {
    const action = () => { onChange(startCardio(Date.now())); setEditing(false); };
    if (!timing.cardioStartedAt && !timing.cardioEndedAt) { action(); return; }
    const message = 'This replaces the recorded start/end times and minutes for this activity. Continue?';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) action();
    } else {
      Alert.alert('Restart cardio timer?', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart', style: 'destructive', onPress: action },
      ]);
    }
  };

  const openCorrection = () => {
    const [sd, st] = localParts(timing.cardioStartedAt);
    const [ed, et] = localParts(timing.cardioEndedAt);
    setCorrectionError('');
    setStartDate(sd); setStartTime(st); setEndDate(ed); setEndTime(et);
    setEditing(true);
  };

  const applyCorrection = () => {
    // Empty both fields to log manual minutes without an HR window.
    if (!startDate && !startTime && !endDate && !endTime) {
      onChange({ cardioStartedAt: undefined, cardioEndedAt: undefined });
      setEditing(false);
      return;
    }
    const start = parseLocalCardioClock(startDate.trim(), startTime.trim());
    const end = parseLocalCardioClock(endDate.trim(), endTime.trim());
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      setCorrectionError('Enter a real date (YYYY-MM-DD) and 24-hour clock (HH:mm) for both times, with end after start.');
      return;
    }
    onChange({ cardioStartedAt: start, cardioEndedAt: end,
      cardioDurationMinutes: String(Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60000))) });
    setEditing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>ACTUAL CARDIO TIME</Text>
      {running ? (
        <>
          <Text style={styles.clock} accessibilityRole="timer">{formatElapsed(elapsedCardioSeconds(timing.cardioStartedAt!, now))}</Text>
          <Text style={styles.hint}>Started {new Date(timing.cardioStartedAt!).toLocaleString()} · timer continues in the background</Text>
          <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel="Stop cardio timer" onPress={() => {
            const result = stopCardio(timing.cardioStartedAt!, Date.now());
            if (result) onChange(result);
            else Alert.alert('Cannot stop yet', 'Wait until the clock passes the start time.');
          }}><Text style={styles.buttonText}>Stop cardio</Text></TouchableOpacity>
        </>
      ) : (
        <>
          {finished ? <Text style={styles.hint}>Recorded: {new Date(timing.cardioStartedAt!).toLocaleString()} → {new Date(timing.cardioEndedAt!).toLocaleString()} · {timing.cardioDurationMinutes} min</Text>
            : <Text style={styles.hint}>Start for an accurate HR window, or enter minutes manually without times.</Text>}
          <TouchableOpacity style={styles.button} accessibilityRole="button" accessibilityLabel={finished ? 'Restart cardio timer' : 'Start cardio timer'} onPress={confirmRestart}>
            <Text style={styles.buttonText}>{finished ? 'Restart timer' : 'Start cardio'}</Text>
          </TouchableOpacity>
          {!editing ? <TouchableOpacity accessibilityRole="button" onPress={openCorrection} style={styles.link}><Text style={styles.linkText}>Correct times manually</Text></TouchableOpacity> : (
            <View style={styles.correction}>
              <Text style={styles.hint}>Local date and 24-hour clock. Leave all four blank to remove recorded times.</Text>
              {([
                ['Start date · YYYY-MM-DD', startDate, setStartDate], ['Start time · HH:mm', startTime, setStartTime],
                ['End date · YYYY-MM-DD', endDate, setEndDate], ['End time · HH:mm', endTime, setEndTime],
              ] as const).map(([label, value, setter]) => (
                <View key={label}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={setter} placeholder={label.includes('date') ? '2026-11-16' : '07:30'} placeholderTextColor={Colors.textMuted} autoCapitalize="none" keyboardType="numbers-and-punctuation" /></View>
              ))}
              {correctionError ? <Text style={styles.error} accessibilityRole="alert">{correctionError}</Text> : null}
              <TouchableOpacity accessibilityRole="button" onPress={applyCorrection} style={styles.link}><Text style={styles.linkText}>Apply times</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={() => setEditing(false)} style={styles.link}><Text style={styles.linkText}>Cancel</Text></TouchableOpacity>
            </View>
          )}
        </>
      )}
      <Text style={styles.hint}>Only a completed time window can verify HR and benchmarks. No pause: stop and start a new activity for a separate segment.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  label: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  clock: { color: Colors.primary, fontSize: 32, fontVariant: ['tabular-nums'], fontWeight: '700' },
  hint: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: '#c53030', fontSize: 12 },
  button: { backgroundColor: Colors.primary, padding: Spacing.sm, borderRadius: Radius.sm, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  buttonText: { color: Colors.background, fontWeight: '700' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: Colors.primary, fontWeight: '600' },
  correction: { gap: Spacing.sm },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm, padding: Spacing.sm, color: Colors.text },
});
