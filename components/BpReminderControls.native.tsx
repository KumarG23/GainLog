import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { buildBpReminderPlan } from '../utils/bpReminderPlan';
const KEY = 'gainlog.bpReminders.enabled.v1', PREFIX = 'gainlog.bp.', CHANNEL = 'blood-pressure';
let queue = Promise.resolve();
function reconcile(enabled: boolean, request = false) {
  queue = queue.catch(() => undefined).then(async () => {
    if (enabled) {
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Blood pressure reminders', importance: Notifications.AndroidImportance.DEFAULT });
      let permission = await Notifications.getPermissionsAsync();
      if (permission.status !== Notifications.PermissionStatus.GRANTED && request && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== Notifications.PermissionStatus.GRANTED) throw new Error('Allow notifications in Android settings to enable BP reminders.');
    }
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of existing.filter(item => item.identifier.startsWith(PREFIX))) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    if (enabled) for (const at of buildBpReminderPlan(new Date())) await Notifications.scheduleNotificationAsync({
      identifier: PREFIX + at.toISOString(),
      content: { title: 'Blood pressure check', body: 'Sit quietly, then take two readings about one minute apart.', data: { url: '/longevity' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
    await AsyncStorage.setItem(KEY, String(enabled));
  });
  return queue;
}
export default function BpReminderControls() {
  const [enabled, setEnabled] = useState(false), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void AsyncStorage.getItem(KEY).then(async value => { setEnabled(value === 'true'); if (value === 'true') await reconcile(true); }).catch(e => setNotice(String(e))); }, []);
  async function toggle() {
    setBusy(true); setNotice('');
    try { await reconcile(!enabled, true); setEnabled(!enabled); setNotice(enabled ? 'BP reminders disabled.' : 'Next two weeks scheduled for Tuesday and Saturday, 8 AM Eastern.'); }
    catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 6 }}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggle()} style={{ padding: 12, backgroundColor: '#247D82', borderRadius: 8 }}><Text style={{ color: 'white' }}>{enabled ? 'Disable' : 'Enable'} BP reminders · Tue/Sat 8 AM Eastern</Text></Pressable><Text style={{ color: '#B3C2CB' }}>Local phone notifications; next 14 days refresh when this screen opens. Android permission and battery policy still apply.</Text>{!!notice && <Text accessibilityRole="alert" style={{ color: '#B3C2CB' }}>{notice}</Text>}</View>;
}
