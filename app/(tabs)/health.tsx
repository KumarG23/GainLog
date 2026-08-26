import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useHealth } from '../../context/HealthContext';
import { formatVolume } from '../../utils/stats';
import { localDateKey, localIsoTimestamp } from '../../utils/date';
import { formatGoalTarget } from '../../utils/goals';
import { syncHealthConnect } from '../../utils/healthConnectSync';
import { beginGoogleHealthConnection, disconnectGoogleHealth, getGoogleHealthStatus, syncGoogleHealth, type GoogleHealthStatus } from '../../utils/googleHealth';

type GoalKind = 'weight' | 'calories' | 'protein' | 'fiber' | 'workout_frequency';

const GOAL_KINDS: { value: GoalKind; label: string; unit: string }[] = [
  { value: 'weight', label: 'Weight', unit: 'lbs' },
  { value: 'calories', label: 'Calories', unit: 'kcal' },
  { value: 'protein', label: 'Protein', unit: 'g' },
  { value: 'fiber', label: 'Fiber', unit: 'g' },
  { value: 'workout_frequency', label: 'Workouts', unit: 'per week' },
];

function todayIso() {
  return localIsoTimestamp();
}

interface SummaryTileProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  color: string;
  onPress?: () => void;
}

function SummaryTile({ icon, label, value, color, onPress }: SummaryTileProps) {
  return (
    <TouchableOpacity
      style={styles.summaryTile}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.72}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label}: ${value}. View trend.` : undefined}
    >
      <View style={[styles.summaryIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {onPress && (
        <Ionicons name="chevron-forward" size={13} color={Colors.textMuted} style={styles.summaryChevron} />
      )}
    </TouchableOpacity>
  );
}

export default function HealthScreen() {
  const router = useRouter();
  const {
    dashboardSummary,
    coachStatus,
    dailyReview,
    goals,
    loading,
    error,
    addBodyWeightEntry,
    addGoal,
    generateDailyReview,
    updateGoal,
    refresh,
  } = useHealth();

  const [weight, setWeight] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalKind, setGoalKind] = useState<GoalKind>('weight');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalMinimum, setGoalMinimum] = useState('');
  const [goalMaximum, setGoalMaximum] = useState('');
  const [goalUnit, setGoalUnit] = useState('lbs');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [reviewingDay, setReviewingDay] = useState(false);
  const [syncingHealthConnect, setSyncingHealthConnect] = useState(false);
  const [googleHealthStatus, setGoogleHealthStatus] = useState<GoogleHealthStatus | null>(null);
  const [googleHealthBusy, setGoogleHealthBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadStatus = () => getGoogleHealthStatus().then(status => { if (mounted) setGoogleHealthStatus(status); }).catch(() => { if (mounted) setGoogleHealthStatus(null); });
    loadStatus();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') loadStatus(); });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const activeGoals = useMemo(
    () => goals.filter(goal => goal.status === 'active'),
    [goals],
  );

  const nutrition = dashboardSummary?.todayNutrition ?? {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
  };
  const latestMeasurement = dashboardSummary?.latestWeight;
  const todayHealth = dashboardSummary?.todayHealth;
  const sleepLabel = todayHealth?.sleepMinutes != null
    ? `${Math.floor(todayHealth.sleepMinutes / 60)}h ${todayHealth.sleepMinutes % 60}m`
    : null;
  const hasComposition = Boolean(
    latestMeasurement &&
      (latestMeasurement.bodyFatPercent != null ||
        latestMeasurement.leanBodyMassLbs != null ||
        latestMeasurement.bmi != null),
  );

  const coachProviderName = coachStatus?.provider
    ? coachStatus.provider.charAt(0).toUpperCase() + coachStatus.provider.slice(1)
    : null;

  const handleKindChange = (kind: GoalKind) => {
    setGoalKind(kind);
    setGoalUnit(GOAL_KINDS.find(item => item.value === kind)?.unit ?? '');
  };

  const handleSaveWeight = async () => {
    const parsedWeight = Number.parseFloat(weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      Alert.alert('Weight needed', 'Enter a valid body weight in pounds.');
      return;
    }

    setSavingWeight(true);
    try {
      await addBodyWeightEntry({
        date: todayIso(),
        weightLbs: parsedWeight,
        notes: weightNotes.trim() || undefined,
      });
      setWeight('');
      setWeightNotes('');
    } catch (err) {
      Alert.alert(
        'Save failed',
        err instanceof Error ? err.message : 'Unable to save body weight.',
      );
    } finally {
      setSavingWeight(false);
    }
  };

  const handleSaveGoal = async () => {
    if (!goalTitle.trim()) {
      Alert.alert('Goal title needed', 'Enter a short goal title.');
      return;
    }

    const parsedTarget = goalTarget.trim()
      ? Number.parseFloat(goalTarget)
      : undefined;
    const parsedMinimum = goalMinimum.trim() ? Number.parseFloat(goalMinimum) : undefined;
    const parsedMaximum = goalMaximum.trim() ? Number.parseFloat(goalMaximum) : undefined;
    if ([parsedMinimum, parsedTarget, parsedMaximum].some(value => value !== undefined && !Number.isFinite(value))) {
      Alert.alert('Target needed', 'Enter valid target numbers.');
      return;
    }
    const orderedValues = [parsedMinimum, parsedTarget, parsedMaximum].filter(
      (value): value is number => value !== undefined,
    );
    if (orderedValues.some((value, index) => index > 0 && value < orderedValues[index - 1])) {
      Alert.alert('Range out of order', 'Use minimum ≤ aim ≤ maximum.');
      return;
    }

    setSavingGoal(true);
    try {
      await addGoal({
        kind: goalKind,
        title: goalTitle.trim(),
        targetValue: parsedTarget,
        minimumValue: parsedMinimum,
        maximumValue: parsedMaximum,
        unit: goalUnit.trim() || undefined,
        startDate: todayIso(),
        targetDate: goalTargetDate.trim() || undefined,
        status: 'active',
        notes: goalNotes.trim() || undefined,
      });
      setGoalTitle('');
      setGoalTarget('');
      setGoalMinimum('');
      setGoalMaximum('');
      setGoalTargetDate('');
      setGoalNotes('');
    } catch (err) {
      Alert.alert(
        'Save failed',
        err instanceof Error ? err.message : 'Unable to save goal.',
      );
    } finally {
      setSavingGoal(false);
    }
  };

  const handleDailyReview = async () => {
    setReviewingDay(true);
    try {
      await generateDailyReview(localDateKey());
    } catch (err) {
      Alert.alert(
        'Review unavailable',
        err instanceof Error ? err.message : 'Unable to generate the daily review.',
      );
    } finally {
      setReviewingDay(false);
    }
  };

  const handleHealthConnectSync = async () => {
    setSyncingHealthConnect(true);
    try {
      const result = await syncHealthConnect({ requestBackgroundAccess: true });
      await refresh();
      Alert.alert(
        'Health Connect synced',
        `Refreshed ${result.dailyImports} days of activity and ${result.bodyMeasurements} body measurement${result.bodyMeasurements === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      Alert.alert('Health Connect sync unavailable', err instanceof Error ? err.message : 'Unable to sync Health Connect.');
    } finally {
      setSyncingHealthConnect(false);
    }
  };

  const handleGoogleHealthConnection = async () => {
    setGoogleHealthBusy(true);
    try {
      if (googleHealthStatus?.connected) {
        await disconnectGoogleHealth();
        setGoogleHealthStatus(await getGoogleHealthStatus());
      } else {
        await beginGoogleHealthConnection();
      }
    } catch (err) {
      Alert.alert('Google Health unavailable', err instanceof Error ? err.message : 'Unable to update Google Health.');
    } finally {
      setGoogleHealthBusy(false);
    }
  };

  const handleGoogleHealthSync = async () => {
    setGoogleHealthBusy(true);
    try {
      const result = await syncGoogleHealth();
      await Promise.all([refresh(), getGoogleHealthStatus().then(setGoogleHealthStatus)]);
      Alert.alert('Google Health synced', `Refreshed ${result.syncedDays} days of wearable data.`);
    } catch (err) {
      Alert.alert('Google Health sync unavailable', err instanceof Error ? err.message : 'Unable to sync Google Health.');
    } finally {
      setGoogleHealthBusy(false);
    }
  };

  if (loading && !dashboardSummary) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={16} color={Colors.warning} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.summaryGrid}>
            <SummaryTile
              icon="scale-outline"
              label="Latest Weight"
              value={
                dashboardSummary?.latestWeight
                  ? `${dashboardSummary.latestWeight.weightLbs.toFixed(1)} lbs`
                  : 'No entry'
              }
              color={Colors.primary}
              onPress={() => router.push('/trends?metric=weight' as Href)}
            />
            <SummaryTile
              icon="restaurant-outline"
              label="Today"
              value={`${nutrition.calories} kcal`}
              color={Colors.warning}
              onPress={() => router.push('/trends?metric=nutrition' as Href)}
            />
            <SummaryTile
              icon="fitness-outline"
              label="Workouts"
              value={String(dashboardSummary?.workoutCount ?? 0)}
              color={Colors.success}
              onPress={() => router.push('/trends?metric=training' as Href)}
            />
            <SummaryTile
              icon="barbell-outline"
              label="Volume"
              value={formatVolume(dashboardSummary?.totalWorkoutVolume ?? 0)}
              color={Colors.textSecondary}
              onPress={() => router.push('/trends?metric=training' as Href)}
            />
          </View>

          {hasComposition && latestMeasurement && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Latest Body Composition</Text>
                <Text style={styles.measurementSource}>
                  {latestMeasurement.source === 'apple-health'
                    ? 'Apple Health'
                    : latestMeasurement.source === 'health-connect'
                      ? 'Health Connect'
                      : latestMeasurement.source ?? 'Manual'}
                </Text>
              </View>
              <View style={styles.compositionRow}>
                {latestMeasurement.bodyFatPercent != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>
                      {latestMeasurement.bodyFatPercent.toFixed(1)}%
                    </Text>
                    <Text style={styles.compositionLabel}>Body fat</Text>
                  </View>
                )}
                {latestMeasurement.leanBodyMassLbs != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>
                      {latestMeasurement.leanBodyMassLbs.toFixed(1)} lb
                    </Text>
                    <Text style={styles.compositionLabel}>Lean mass</Text>
                  </View>
                )}
                {latestMeasurement.bmi != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>
                      {latestMeasurement.bmi.toFixed(1)}
                    </Text>
                    <Text style={styles.compositionLabel}>BMI</Text>
                  </View>
                )}
              </View>
              <Text style={styles.compositionHint}>
                Smart-scale composition is most useful as a long-term trend, not a single reading.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Google Health</Text>
              <Text style={styles.measurementSource}>{googleHealthStatus?.connected ? 'Connected' : 'Server sync'}</Text>
            </View>
            <Text style={styles.compositionHint}>
              {googleHealthStatus?.connected
                ? `Direct Fitbit/Pixel Watch reconciliation is connected${googleHealthStatus.lastSuccessAt ? ` · Last success ${googleHealthStatus.lastSuccessAt}` : ''}.`
                : googleHealthStatus?.configured ? 'Connect Fitbit or Pixel Watch data in your browser. Credentials stay on the server.' : 'Google Health is not configured on this server.'}
            </Text>
            {googleHealthStatus?.lastError && <Text style={styles.errorText}>{googleHealthStatus.lastError}</Text>}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGoogleHealthConnection}
              disabled={googleHealthBusy || !googleHealthStatus?.configured}
              accessibilityRole="button"
              accessibilityLabel={googleHealthStatus?.connected ? 'Disconnect Google Health' : 'Connect Google Health'}
            >
              {googleHealthBusy ? <ActivityIndicator color={Colors.background} /> : <Text style={styles.primaryButtonText}>{googleHealthStatus?.connected ? 'Disconnect' : 'Connect Google Health'}</Text>}
            </TouchableOpacity>
            {googleHealthStatus?.connected && (
              <TouchableOpacity style={styles.primaryButton} onPress={handleGoogleHealthSync} disabled={googleHealthBusy} accessibilityRole="button" accessibilityLabel="Sync Google Health now">
                <Text style={styles.primaryButtonText}>Sync now</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Health Connect</Text>
              <Text style={styles.measurementSource}>Android only</Text>
            </View>
            <Text style={styles.compositionHint}>
              GainLog syncs Health Connect when the app opens and periodically in the background. Android controls the exact background timing; Sync now remains available as a recovery check.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleHealthConnectSync}
              disabled={syncingHealthConnect}
              accessibilityRole="button"
              accessibilityLabel="Sync Health Connect now"
            >
              {syncingHealthConnect ? <ActivityIndicator color={Colors.background} /> : <Text style={styles.primaryButtonText}>Sync now</Text>}
            </TouchableOpacity>
          </View>

          {todayHealth && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recovery & Activity</Text>
                <Text style={styles.measurementSource}>
                  {todayHealth.source === 'google-health'
                    ? 'Google Health'
                    : todayHealth.source === 'health-connect'
                      ? 'Health Connect'
                      : 'Apple Health'}
                </Text>
              </View>
              <View style={styles.compositionRow}>
                {sleepLabel && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>{sleepLabel}</Text>
                    <Text style={styles.compositionLabel}>Sleep</Text>
                  </View>
                )}
                {todayHealth.restingHeartRateBpm != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>
                      {todayHealth.restingHeartRateBpm.toFixed(0)} bpm
                    </Text>
                    <Text style={styles.compositionLabel}>Resting HR</Text>
                  </View>
                )}
                {todayHealth.hrvMs != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>{todayHealth.hrvMs.toFixed(0)} ms</Text>
                    <Text style={styles.compositionLabel}>HRV</Text>
                  </View>
                )}
                {todayHealth.steps != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>{todayHealth.steps.toLocaleString()}</Text>
                    <Text style={styles.compositionLabel}>Steps</Text>
                  </View>
                )}
                {(todayHealth.totalCalories != null || todayHealth.activeCalories != null) && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>
                      {(todayHealth.activeCalories && todayHealth.activeCalories > 0
                        ? todayHealth.activeCalories
                        : todayHealth.totalCalories ?? 0).toFixed(0)} kcal
                    </Text>
                    <Text style={styles.compositionLabel}>
                      {todayHealth.activeCalories && todayHealth.activeCalories > 0 ? 'Active' : 'Total'}
                    </Text>
                  </View>
                )}
                {todayHealth.exerciseMinutes != null && (
                  <View style={styles.compositionMetric}>
                    <Text style={styles.compositionValue}>{todayHealth.exerciseMinutes} min</Text>
                    <Text style={styles.compositionLabel}>Exercise</Text>
                  </View>
                )}
              </View>
              {(todayHealth.deepSleepMinutes != null ||
                todayHealth.coreSleepMinutes != null ||
                todayHealth.remSleepMinutes != null ||
                todayHealth.awakeMinutes != null) && (
                <Text style={styles.compositionHint}>
                  Sleep stages: {[
                    todayHealth.deepSleepMinutes != null
                      ? `Deep ${todayHealth.deepSleepMinutes}m`
                      : null,
                    todayHealth.coreSleepMinutes != null
                      ? `Core ${todayHealth.coreSleepMinutes}m`
                      : null,
                    todayHealth.remSleepMinutes != null
                      ? `REM ${todayHealth.remSleepMinutes}m`
                      : null,
                    todayHealth.awakeMinutes != null
                      ? `Awake ${todayHealth.awakeMinutes}m`
                      : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              )}
              {(todayHealth.standHours != null || todayHealth.walkingRunningMiles != null) && (
                <Text style={styles.compositionHint}>
                  {[
                    todayHealth.standHours != null
                      ? `${todayHealth.standHours} stand hours`
                      : null,
                    todayHealth.walkingRunningMiles != null
                      ? `${todayHealth.walkingRunningMiles.toFixed(1)} walking/running miles`
                      : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              )}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.coachRow}>
              <View style={styles.coachIcon}>
                <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
              </View>
              <View style={styles.coachBody}>
                <Text style={styles.sectionTitle}>AI Coach</Text>
                <Text style={styles.coachTitle}>
                  {coachStatus
                    ? `${coachProviderName} ${coachStatus.model ?? ''}`.trim()
                    : 'unavailable'}
                </Text>
                <Text style={styles.coachStatus}>
                  {coachStatus?.configured
                    ? coachStatus.provider === 'ollama'
                      ? 'Local provider configured'
                      : 'Provider configured'
                    : 'Provider not configured'}
                </Text>
                {coachStatus?.baseUrl && (
                  <Text style={styles.coachMeta}>{coachStatus.baseUrl}</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.reviewTitleRow}>
                <Ionicons name="analytics-outline" size={18} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Daily Review</Text>
              </View>
              {dailyReview && (
                <Text style={styles.reviewDate}>{dailyReview.date}</Text>
              )}
            </View>
            <Text style={styles.reviewHint}>
              Combines today’s weight, meals, macros, training, sleep, recovery, and activity.
            </Text>
            {dailyReview && (
              <Text style={styles.reviewText}>{dailyReview.review}</Text>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, reviewingDay && styles.buttonDisabled]}
              onPress={handleDailyReview}
              disabled={reviewingDay || !coachStatus?.configured}
            >
              {reviewingDay ? (
                <ActivityIndicator size="small" color={Colors.text} />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color={Colors.text} />
              )}
              <Text style={styles.primaryButtonText}>
                {reviewingDay
                  ? 'Reviewing Day'
                  : dailyReview
                    ? 'Refresh Daily Review'
                    : 'Generate Daily Review'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Today’s Macros</Text>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push('/nutrition' as Href)}
                accessibilityLabel="Open nutrition"
              >
                <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.macroRow}>
              <Text style={styles.macroText}>{nutrition.proteinG}g protein</Text>
              <Text style={styles.macroText}>{nutrition.carbsG}g carbs</Text>
              <Text style={styles.macroText}>{nutrition.fatG}g fat</Text>
              <Text style={styles.macroText}>{nutrition.fiberG}g fiber</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add Weight</Text>
            <TextInput
              style={styles.input}
              value={weight}
              onChangeText={setWeight}
              placeholder="Weight in lbs"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={weightNotes}
              onChangeText={setWeightNotes}
              placeholder="Notes"
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <TouchableOpacity
              style={[styles.primaryButton, savingWeight && styles.buttonDisabled]}
              onPress={handleSaveWeight}
              disabled={savingWeight}
            >
              <Ionicons name="save-outline" size={16} color={Colors.text} />
              <Text style={styles.primaryButtonText}>
                {savingWeight ? 'Saving' : 'Save Weight'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Goals</Text>
            {activeGoals.length === 0 ? (
              <Text style={styles.emptyText}>No active goals yet.</Text>
            ) : (
              activeGoals.map(goal => (
                <View key={goal.id} style={styles.goalRow}>
                  <View style={styles.goalBody}>
                    <Text style={styles.goalTitle}>{goal.title}</Text>
                    <Text style={styles.goalMeta}>
                      {formatGoalTarget(goal) || goal.kind}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.smallButton}
                    onPress={() => updateGoal(goal.id, { status: 'completed' })}
                  >
                    <Ionicons name="checkmark" size={14} color={Colors.success} />
                    <Text style={styles.smallButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add Goal</Text>
            <TextInput
              style={styles.input}
              value={goalTitle}
              onChangeText={setGoalTitle}
              placeholder="Goal title"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.segmented}>
              {GOAL_KINDS.map(item => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.segment,
                    goalKind === item.value && styles.segmentActive,
                  ]}
                  onPress={() => handleKindChange(item.value)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      goalKind === item.value && styles.segmentTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={goalMinimum}
                onChangeText={setGoalMinimum}
                placeholder="Minimum"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={goalTarget}
                onChangeText={setGoalTarget}
                placeholder="Aim"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={goalMaximum}
                onChangeText={setGoalMaximum}
                placeholder="Maximum"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={goalUnit}
                onChangeText={setGoalUnit}
                placeholder="Unit"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <TextInput
              style={styles.input}
              value={goalTargetDate}
              onChangeText={setGoalTargetDate}
              placeholder="Target date, optional"
              placeholderTextColor={Colors.textMuted}
            />
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={goalNotes}
              onChangeText={setGoalNotes}
              placeholder="Notes"
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <TouchableOpacity
              style={[styles.primaryButton, savingGoal && styles.buttonDisabled]}
              onPress={handleSaveGoal}
              disabled={savingGoal}
            >
              <Ionicons name="flag-outline" size={16} color={Colors.text} />
              <Text style={styles.primaryButtonText}>
                {savingGoal ? 'Saving' : 'Save Goal'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.base,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  errorText: { flex: 1, color: Colors.text, fontSize: FontSize.sm },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryTile: {
    width: '48%',
    minHeight: 112,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    justifyContent: 'space-between',
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '800',
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  summaryChevron: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
  },
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
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '800',
  },
  measurementSource: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  compositionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  compositionMetric: {
    flexGrow: 1,
    minWidth: 88,
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    gap: 3,
  },
  compositionValue: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '800',
  },
  compositionLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  compositionHint: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 17,
  },
  coachRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  coachIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachBody: { flex: 1, gap: 3 },
  coachTitle: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '800',
  },
  coachStatus: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  coachMeta: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
  reviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  reviewDate: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  reviewHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  reviewText: {
    color: Colors.text,
    fontSize: FontSize.base,
    lineHeight: 23,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryDim,
  },
  macroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  macroText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    backgroundColor: Colors.inputBg,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: FontSize.base,
  },
  multilineInput: {
    minHeight: 76,
    paddingTop: Spacing.md,
    textAlignVertical: 'top',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '800',
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomColor: Colors.separator,
    borderBottomWidth: 1,
  },
  goalBody: { flex: 1, gap: 2 },
  goalTitle: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  goalMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    minHeight: 32,
    borderRadius: Radius.sm,
    backgroundColor: Colors.successDim,
  },
  smallButtonText: {
    color: Colors.success,
    fontSize: FontSize.xs,
    fontWeight: '800',
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  segment: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  segmentText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  segmentTextActive: { color: Colors.primary },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  rowInput: { flex: 1 },
});
