import * as Notifications from 'expo-notifications';
import { Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useHealth } from '../context/HealthContext';
import { reconcileMealNotifications } from '../utils/mealNotifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function MealNotificationCoordinator() {
  const { nutritionEntries, loading, error } = useHealth();
  const router = useRouter();

  useEffect(() => {
    if (loading || error || Platform.OS === 'web') return;
    reconcileMealNotifications(nutritionEntries).catch(error => {
      console.warn('Unable to reconcile meal notifications', error);
    });
  }, [error, loading, nutritionEntries]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const openNotification = (response: Notifications.NotificationResponse) => {
      const url = response.notification.request.content.data?.url;
      if (url === '/nutrition') router.push(url as Href);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(
      openNotification,
    );
    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (!response) return;
        openNotification(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(error => {
        console.warn('Unable to process notification response', error);
      });

    return () => subscription.remove();
  }, [router]);

  return null;
}
