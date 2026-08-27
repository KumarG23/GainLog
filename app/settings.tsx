import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import { useHealth } from '../context/HealthContext';
import { repairHealthConnect, syncHealthConnect } from '../utils/healthConnectSync';
import { formatSyncTimestamp } from '../utils/settingsDisplay';
import {
  beginGoogleHealthConnection,
  disconnectGoogleHealth,
  getGoogleHealthStatus,
  syncGoogleHealth,
  type GoogleHealthStatus,
} from '../utils/googleHealth';

export default function SettingsScreen() {
  const { refresh, syncNutritionToHealthConnect, nutritionHealthConnectError } = useHealth();
  const [syncingHealthConnect, setSyncingHealthConnect] = useState(false);
  const [syncingNutrition, setSyncingNutrition] = useState(false);
  const [googleHealthStatus, setGoogleHealthStatus] = useState<GoogleHealthStatus | null>(null);
  const [googleHealthBusy, setGoogleHealthBusy] = useState(false);
  const [showRecoveryTools, setShowRecoveryTools] = useState(false);

  const loadGoogleHealthStatus = useCallback(async () => {
    try {
      setGoogleHealthStatus(await getGoogleHealthStatus());
    } catch {
      setGoogleHealthStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadGoogleHealthStatus();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void loadGoogleHealthStatus();
    });
    return () => subscription.remove();
  }, [loadGoogleHealthStatus]);

  const handleGoogleHealthConnection = async () => {
    setGoogleHealthBusy(true);
    try {
      if (googleHealthStatus?.connected) {
        await disconnectGoogleHealth();
        await loadGoogleHealthStatus();
      } else {
        await beginGoogleHealthConnection();
      }
    } catch (error) {
      Alert.alert(
        'Google Health unavailable',
        error instanceof Error ? error.message : 'Unable to update Google Health.',
      );
    } finally {
      setGoogleHealthBusy(false);
    }
  };

  const handleGoogleHealthSync = async () => {
    setGoogleHealthBusy(true);
    try {
      const result = await syncGoogleHealth();
      await Promise.all([refresh(), loadGoogleHealthStatus()]);
      Alert.alert('Google Health synced', `Refreshed ${result.syncedDays} days of wearable data.`);
    } catch (error) {
      Alert.alert(
        'Google Health sync unavailable',
        error instanceof Error ? error.message : 'Unable to sync Google Health.',
      );
    } finally {
      setGoogleHealthBusy(false);
    }
  };

  const handleHealthConnectSync = async () => {
    setSyncingHealthConnect(true);
    try {
      const result = await syncHealthConnect({
        requestBackgroundAccess: true,
        repairIfRequired: true,
      });
      await refresh();
      Alert.alert(
        'Health Connect synced',
        `Refreshed ${result.dailyImports} days of activity and ${result.bodyMeasurements} body measurement${result.bodyMeasurements === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      Alert.alert(
        'Health Connect sync unavailable',
        error instanceof Error ? error.message : 'Unable to sync Health Connect.',
      );
    } finally {
      setSyncingHealthConnect(false);
    }
  };

  const handleHealthConnectRepair = async () => {
    setSyncingHealthConnect(true);
    try {
      const result = await repairHealthConnect();
      await refresh();
      Alert.alert(
        'Health Connect repaired',
        `Reconciled ${result.dailyImports} days and ${result.bodyMeasurements} body measurement${result.bodyMeasurements === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      Alert.alert(
        'Health Connect repair unavailable',
        error instanceof Error ? error.message : 'Unable to repair Health Connect.',
      );
    } finally {
      setSyncingHealthConnect(false);
    }
  };

  const handleNutritionRepair = async () => {
    setSyncingNutrition(true);
    try {
      const written = await syncNutritionToHealthConnect();
      Alert.alert(
        'Nutrition repair complete',
        `Reconciled ${written} GainLog meal${written === 1 ? '' : 's'} with Health Connect.`,
      );
    } catch (error) {
      Alert.alert(
        'Nutrition sync failed',
        error instanceof Error ? error.message : 'Unable to write nutrition to Health Connect.',
      );
    } finally {
      setSyncingNutrition(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Ionicons name="sync-outline" size={20} color={Colors.primary} />
          <View style={styles.introCopy}>
            <Text style={styles.introTitle}>Data & Sync</Text>
            <Text style={styles.hint}>
              GainLog refreshes when it opens or returns to the foreground. Android background timing remains best-effort; these controls are recovery tools.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Google Health</Text>
            <Text style={styles.badge}>
              {googleHealthStatus?.connected ? 'Connected' : 'Server sync'}
            </Text>
          </View>
          <Text style={styles.hint}>
            {googleHealthStatus?.connected
              ? `Direct Fitbit/Pixel Watch reconciliation is connected${googleHealthStatus.lastSuccessAt ? ` · Last success ${formatSyncTimestamp(googleHealthStatus.lastSuccessAt)}` : ''}.`
              : googleHealthStatus?.configured
                ? 'Connect Fitbit or Pixel Watch data in your browser. Credentials stay on the server.'
                : 'Google Health is not configured on this server.'}
          </Text>
          {googleHealthStatus?.lastError && <Text style={styles.errorText}>{googleHealthStatus.lastError}</Text>}
          {googleHealthStatus?.connected ? (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, googleHealthBusy && styles.buttonDisabled]}
                onPress={handleGoogleHealthSync}
                disabled={googleHealthBusy}
                accessibilityRole="button"
                accessibilityLabel="Sync Google Health now"
              >
                {googleHealthBusy
                  ? <ActivityIndicator size="small" color={Colors.text} />
                  : <Ionicons name="refresh-outline" size={17} color={Colors.text} />}
                <Text style={styles.primaryButtonText}>Sync now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.destructiveButton, googleHealthBusy && styles.buttonDisabled]}
                onPress={handleGoogleHealthConnection}
                disabled={googleHealthBusy}
                accessibilityRole="button"
                accessibilityLabel="Disconnect Google Health"
              >
                <Text style={styles.destructiveButtonText}>Disconnect Google Health</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryButton, googleHealthBusy && styles.buttonDisabled]}
              onPress={handleGoogleHealthConnection}
              disabled={googleHealthBusy || !googleHealthStatus?.configured}
              accessibilityRole="button"
              accessibilityLabel="Connect Google Health"
            >
              {googleHealthBusy && <ActivityIndicator size="small" color={Colors.text} />}
              <Text style={styles.primaryButtonText}>Connect Google Health</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Health Connect</Text>
            <Text style={styles.badge}>Android only</Text>
          </View>
          <Text style={styles.hint}>
            RENPHO weight and body composition sync automatically on app foreground and approximately hourly in the background. A repair is needed only when Android invalidates the incremental cursor.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              syncingHealthConnect && styles.buttonDisabled,
              Platform.OS !== 'android' && styles.buttonDisabled,
              Platform.OS !== 'android' && styles.platformUnavailableButton,
            ]}
            onPress={handleHealthConnectSync}
            disabled={syncingHealthConnect || Platform.OS !== 'android'}
            accessibilityRole="button"
            accessibilityLabel="Sync Health Connect now"
          >
            {syncingHealthConnect
              ? <ActivityIndicator size="small" color={Colors.text} />
              : <Ionicons name="refresh-outline" size={17} color={Colors.text} />}
            <Text style={styles.primaryButtonText}>Sync now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.recoveryDisclosure}
            onPress={() => setShowRecoveryTools(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={`${showRecoveryTools ? 'Hide' : 'Show'} Health Connect recovery tools`}
            accessibilityState={{ expanded: showRecoveryTools }}
            aria-expanded={showRecoveryTools}
          >
            <View style={styles.recoveryDisclosureCopy}>
              <Ionicons name="construct-outline" size={17} color={Colors.textMuted} />
              <View>
                <Text style={styles.recoveryDisclosureTitle}>Recovery tools</Text>
                <Text style={styles.recoveryDisclosureHint}>Repairs only · normal sync is automatic</Text>
              </View>
            </View>
            <Ionicons
              name={showRecoveryTools ? 'chevron-up' : 'chevron-down'}
              size={17}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
          {showRecoveryTools && (
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                syncingHealthConnect && styles.buttonDisabled,
                Platform.OS !== 'android' && styles.buttonDisabled,
                Platform.OS !== 'android' && styles.platformUnavailableButton,
              ]}
              onPress={handleHealthConnectRepair}
              disabled={syncingHealthConnect || Platform.OS !== 'android'}
              accessibilityRole="button"
              accessibilityLabel="Repair imported Health Connect history"
            >
              <Ionicons name="construct-outline" size={17} color={Colors.primary} />
              <Text style={styles.secondaryButtonText}>Repair imported history</Text>
            </TouchableOpacity>
          )}
        </View>

        {showRecoveryTools && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Nutrition maintenance</Text>
              <Text style={styles.badge}>Recovery</Text>
            </View>
            <Text style={styles.hint}>
              Normal meal additions and deletions mirror automatically. Run this only to reconcile older or previously failed entries.
            </Text>
            {nutritionHealthConnectError && <Text style={styles.errorText}>{nutritionHealthConnectError}</Text>}
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                syncingNutrition && styles.buttonDisabled,
                Platform.OS !== 'android' && styles.buttonDisabled,
                Platform.OS !== 'android' && styles.platformUnavailableButton,
              ]}
              onPress={handleNutritionRepair}
              disabled={syncingNutrition || Platform.OS !== 'android'}
              accessibilityRole="button"
              accessibilityLabel="Repair all GainLog nutrition in Health Connect"
            >
              {syncingNutrition
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Ionicons name="restaurant-outline" size={17} color={Colors.primary} />}
              <Text style={styles.secondaryButtonText}>Repair all nutrition</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.base,
  },
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  introCopy: { flex: 1, gap: Spacing.xs },
  introTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  section: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sectionTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  badge: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  hint: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },
  errorText: { color: Colors.warning, fontSize: FontSize.sm, lineHeight: 19 },
  primaryButton: {
    minHeight: 48,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  primaryButtonText: { color: Colors.text, fontSize: FontSize.base, fontWeight: '800' },
  secondaryButton: {
    minHeight: 48,
    borderRadius: Radius.sm,
    borderColor: Colors.primary,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  secondaryButtonText: { color: Colors.primary, fontSize: FontSize.base, fontWeight: '800' },
  recoveryDisclosure: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
    paddingTop: Spacing.md,
  },
  recoveryDisclosureCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recoveryDisclosureTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  recoveryDisclosureHint: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  destructiveButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveButtonText: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  platformUnavailableButton: {
    backgroundColor: Colors.card,
    borderColor: Colors.borderSubtle,
    opacity: 0.7,
  },
  buttonDisabled: { opacity: 0.55 },
});
