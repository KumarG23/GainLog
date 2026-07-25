import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
}

function SummaryTile({ icon, label, value, color }: SummaryTileProps) {
  return (
    <View style={styles.summaryTile}>
      <View style={[styles.summaryIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
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
  } = useHealth();

  const [weight, setWeight] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalKind, setGoalKind] = useState<GoalKind>('weight');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalUnit, setGoalUnit] = useState('lbs');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [reviewingDay, setReviewingDay] = useState(false);

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
    if (parsedTarget !== undefined && !Number.isFinite(parsedTarget)) {
      Alert.alert('Target needed', 'Enter a valid target number.');
      return;
    }

    setSavingGoal(true);
    try {
      await addGoal({
        kind: goalKind,
        title: goalTitle.trim(),
        targetValue: parsedTarget,
        unit: goalUnit.trim() || undefined,
        startDate: todayIso(),
        targetDate: goalTargetDate.trim() || undefined,
        status: 'active',
        notes: goalNotes.trim() || undefined,
      });
      setGoalTitle('');
      setGoalTarget('');
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
            />
            <SummaryTile
              icon="restaurant-outline"
              label="Today"
              value={`${nutrition.calories} kcal`}
              color={Colors.warning}
            />
            <SummaryTile
              icon="fitness-outline"
              label="Workouts"
              value={String(dashboardSummary?.workoutCount ?? 0)}
              color={Colors.success}
            />
            <SummaryTile
              icon="barbell-outline"
              label="Volume"
              value={formatVolume(dashboardSummary?.totalWorkoutVolume ?? 0)}
              color={Colors.textSecondary}
            />
          </View>

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
              Combines today’s weight, meals, macros, goals, and training.
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
                      {goal.targetValue != null
                        ? `${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ''}`
                        : goal.kind}
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
                value={goalTarget}
                onChangeText={setGoalTarget}
                placeholder="Target"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
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
