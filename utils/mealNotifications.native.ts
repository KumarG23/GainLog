import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NutritionEntry } from '../types/health';
import {
  buildLoggedMealKeys,
  buildMealReminderPlan,
  buildTestMealReminder,
} from './mealReminderPlan';

const STORAGE_KEY = 'gainlog.mealReminderIds.v1';
const CHANNEL_ID = 'meal-reminders';
const SCHEDULE_DAYS = 7;

type ScheduledReminder = {
  key: string;
  id: string;
};

let reconciliationQueue: Promise<void> = Promise.resolve();

async function readScheduledReminders(): Promise<ScheduledReminder[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Meal reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 150, 250],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === Notifications.PermissionStatus.GRANTED) return true;
  if (!current.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === Notifications.PermissionStatus.GRANTED;
}

async function reconcile(entries: NutritionEntry[]): Promise<void> {
  if (!(await ensureNotificationPermission())) return;

  const existing = await readScheduledReminders();
  await Promise.all(
    existing.map(reminder =>
      Notifications.cancelScheduledNotificationAsync(reminder.id).catch(() => undefined),
    ),
  );

  const plan = buildMealReminderPlan({
    now: new Date(),
    days: SCHEDULE_DAYS,
    loggedMealKeys: buildLoggedMealKeys(entries),
  });
  const scheduled: ScheduledReminder[] = [];

  for (const item of plan) {
    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: item.trigger,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    };
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        sound: 'default',
        data: {
          url: '/nutrition',
          meal: item.meal,
          reminderKey: item.key,
        },
      },
      trigger,
    });
    scheduled.push({ key: item.key, id });
  }

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scheduled));
}

export function reconcileMealNotifications(entries: NutritionEntry[]): Promise<void> {
  reconciliationQueue = reconciliationQueue
    .catch(() => undefined)
    .then(() => reconcile(entries));
  return reconciliationQueue;
}

export async function scheduleTestMealNotification(delaySeconds = 5): Promise<boolean> {
  if (!(await ensureNotificationPermission())) return false;

  const reminder = buildTestMealReminder(new Date(), delaySeconds);
  const trigger: Notifications.DateTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: reminder.trigger,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
  };

  await Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.body,
      sound: 'default',
      data: { url: '/nutrition', test: true },
    },
    trigger,
  });
  return true;
}
