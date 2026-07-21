import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import { scheduleTestMealNotification } from '../utils/mealNotifications';

export function NotificationTestButton() {
  const [scheduling, setScheduling] = useState(false);

  const scheduleTest = async () => {
    setScheduling(true);
    try {
      const scheduled = await scheduleTestMealNotification(5);
      if (!scheduled) {
        Alert.alert(
          'Notifications are disabled',
          'Enable notifications for Expo Go in your phone settings, then try again.',
        );
        return;
      }
      Alert.alert(
        'Test reminder scheduled',
        'It should arrive in about five seconds. GainLog can stay open.',
      );
    } catch (error) {
      Alert.alert(
        'Test failed',
        error instanceof Error ? error.message : 'Unable to schedule the test reminder.',
      );
    } finally {
      setScheduling(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>Meal Reminders</Text>
        <Text style={styles.subtitle}>Send a five-second test through Expo Go.</Text>
      </View>
      <TouchableOpacity
        style={[styles.button, scheduling && styles.disabled]}
        onPress={scheduleTest}
        disabled={scheduling}
        accessibilityRole="button"
        accessibilityLabel="Send test meal reminder"
      >
        {scheduling ? (
          <ActivityIndicator size="small" color={Colors.text} />
        ) : (
          <Ionicons name="notifications-outline" size={17} color={Colors.text} />
        )}
        <Text style={styles.buttonText}>{scheduling ? 'Scheduling' : 'Send Test'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  copy: { gap: Spacing.xs },
  title: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  subtitle: { color: Colors.textMuted, fontSize: FontSize.sm },
  button: {
    minHeight: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: Colors.text, fontSize: FontSize.base, fontWeight: '800' },
});
