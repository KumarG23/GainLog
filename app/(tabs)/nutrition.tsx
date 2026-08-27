import React, { useMemo, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useHealth } from '../../context/HealthContext';
import { localDateKey, localIsoTimestamp, previousLocalDateKey } from '../../utils/date';
import {
  buildDailyMacroHistory,
  buildQuickAddFoods,
  type QuickAddFood,
} from '../../utils/nutritionMemory';
import {
  averageMacroDays,
  buildCalorieHistoryScale,
  formatNutritionProgress,
  nutritionGoalReferenceValue,
  selectNutritionGoals,
} from '../../utils/nutritionDisplay';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

function toNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHistoryDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function NutritionScreen() {
  const {
    nutritionEntries,
    dashboardSummary,
    goals,
    loading,
    error,
    nutritionHealthConnectError,
    addNutritionEntry,
    deleteNutritionEntry,
  } = useHealth();

  const [meal, setMeal] = useState('breakfast');
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [quickAdding, setQuickAdding] = useState<string | null>(null);
  const [showAllQuickAdds, setShowAllQuickAdds] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const quickAddLock = useRef(false);

  const today = localDateKey();
  const completedHistoryEnd = previousLocalDateKey(new Date(`${today}T12:00:00`));
  const todayEntries = useMemo(
    () => nutritionEntries.filter(entry => entry.date.startsWith(today)),
    [nutritionEntries, today],
  );

  const totals = dashboardSummary?.todayNutrition ?? {
    calories: todayEntries.reduce((sum, entry) => sum + entry.calories, 0),
    proteinG: todayEntries.reduce((sum, entry) => sum + entry.proteinG, 0),
    carbsG: todayEntries.reduce((sum, entry) => sum + entry.carbsG, 0),
    fatG: todayEntries.reduce((sum, entry) => sum + entry.fatG, 0),
    fiberG: todayEntries.reduce((sum, entry) => sum + entry.fiberG, 0),
  };

  const quickAdds = useMemo(
    () => buildQuickAddFoods(nutritionEntries, 6),
    [nutritionEntries],
  );
  const visibleQuickAdds = showAllQuickAdds ? quickAdds : quickAdds.slice(0, 3);
  const macroHistory = useMemo(
    () => buildDailyMacroHistory(nutritionEntries, today, 7),
    [nutritionEntries, today],
  );
  const completedMacroHistory = useMemo(
    () => buildDailyMacroHistory(nutritionEntries, completedHistoryEnd, 7),
    [nutritionEntries, completedHistoryEnd],
  );
  const macroAverages = useMemo(
    () => averageMacroDays(completedMacroHistory),
    [completedMacroHistory],
  );
  const nutritionGoals = useMemo(() => selectNutritionGoals(goals), [goals]);
  const calorieProgress = formatNutritionProgress(totals.calories, nutritionGoals.calories);
  const proteinProgress = formatNutritionProgress(totals.proteinG, nutritionGoals.protein);
  const fiberProgress = formatNutritionProgress(totals.fiberG, nutritionGoals.fiber);
  const calorieHistoryScale = buildCalorieHistoryScale(
    macroHistory.map(day => day.calories),
    nutritionGoalReferenceValue(nutritionGoals.calories),
  );

  const handleQuickAdd = async (food: QuickAddFood) => {
    if (quickAddLock.current) return;
    quickAddLock.current = true;
    const key = `${food.meal}:${food.name}`;
    setQuickAdding(key);
    try {
      await addNutritionEntry({
        date: localIsoTimestamp(),
        meal: food.meal,
        name: food.name,
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: food.fiberG,
        notes: food.notes,
      });
    } catch (err) {
      Alert.alert(
        'Quick add failed',
        err instanceof Error ? err.message : 'Unable to add that meal.',
      );
    } finally {
      quickAddLock.current = false;
      setQuickAdding(null);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Food name needed', 'Enter what you ate.');
      return;
    }
    const parsedCalories = Number.parseInt(calories, 10);
    if (!Number.isFinite(parsedCalories) || parsedCalories < 0) {
      Alert.alert('Calories needed', 'Enter calories as a whole number.');
      return;
    }

    setSaving(true);
    try {
      await addNutritionEntry({
        date: localIsoTimestamp(),
        meal,
        name: name.trim(),
        calories: parsedCalories,
        proteinG: toNumber(protein),
        carbsG: toNumber(carbs),
        fatG: toNumber(fat),
        fiberG: toNumber(fiber),
        notes: notes.trim() || undefined,
      });
      setName('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      setFiber('');
      setNotes('');
    } catch (err) {
      Alert.alert(
        'Save failed',
        err instanceof Error ? err.message : 'Unable to save food entry.',
      );
    } finally {
      setSaving(false);
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
          {nutritionHealthConnectError && (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={16} color={Colors.warning} />
              <Text style={styles.errorText}>{nutritionHealthConnectError}</Text>
            </View>
          )}

          <View style={styles.totalCard}>
            <View style={styles.totalHeading}>
              <View>
                <Text style={styles.totalLabel}>Today · in progress</Text>
                <Text style={styles.totalValue}>{totals.calories.toLocaleString()} kcal</Text>
              </View>
              {calorieProgress.targetLabel && (
                <Text style={styles.totalTarget}>{calorieProgress.targetLabel}</Text>
              )}
            </View>
            {calorieProgress.targetLabel && (
              <View style={styles.goalTrack}>
                <View
                  style={[
                    styles.goalBar,
                    { width: `${Math.min(1, calorieProgress.progress) * 100}%` },
                  ]}
                />
              </View>
            )}
            <View style={styles.goalGrid}>
              <View style={styles.goalMetric}>
                <View style={styles.goalMetricHeading}>
                  <Text style={styles.goalMetricLabel}>Protein</Text>
                  <Text style={styles.goalMetricValue}>{proteinProgress.valueLabel}</Text>
                </View>
                {proteinProgress.targetLabel && (
                  <>
                    <View style={styles.goalTrackSmall}>
                      <View
                        style={[
                          styles.goalBar,
                          proteinProgress.status === 'within' && styles.goalBarSuccess,
                          { width: `${Math.min(1, proteinProgress.progress) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.goalMetricTarget}>{proteinProgress.targetLabel}</Text>
                  </>
                )}
              </View>
              <View style={styles.goalMetric}>
                <View style={styles.goalMetricHeading}>
                  <Text style={styles.goalMetricLabel}>Fiber</Text>
                  <Text style={styles.goalMetricValue}>{fiberProgress.valueLabel}</Text>
                </View>
                {fiberProgress.targetLabel && (
                  <>
                    <View style={styles.goalTrackSmall}>
                      <View
                        style={[
                          styles.goalBar,
                          fiberProgress.status === 'within' && styles.goalBarSuccess,
                          { width: `${Math.min(1, fiberProgress.progress) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.goalMetricTarget}>{fiberProgress.targetLabel}</Text>
                  </>
                )}
              </View>
            </View>
            <Text style={styles.secondaryMacros}>
              {totals.carbsG}g carbs · {totals.fatG}g fat
            </Text>
          </View>


          {quickAdds.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeadingRow}>
                <View style={styles.sectionHeadingCopy}>
                  <Text style={styles.sectionTitle}>Quick Add</Text>
                  <Text style={styles.sectionSubtitle}>
                    GainLog remembers what you log most often.
                  </Text>
                </View>
                <Ionicons name="flash-outline" size={20} color={Colors.primary} />
              </View>
              <View style={styles.quickAddList}>
                {visibleQuickAdds.map(food => {
                  const key = `${food.meal}:${food.name}`;
                  const isAdding = quickAdding === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.quickAddButton,
                        quickAdding !== null && styles.buttonDisabled,
                      ]}
                      onPress={() => handleQuickAdd(food)}
                      disabled={quickAdding !== null}
                      accessibilityLabel={`Add ${food.name}`}
                    >
                      <View style={styles.quickAddCopy}>
                        <Text style={styles.quickAddName}>{food.name}</Text>
                        <Text style={styles.quickAddMeta}>
                          {food.meal} · {food.calories} kcal · {food.proteinG}g protein
                        </Text>
                      </View>
                      {isAdding ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <Ionicons name="add-circle" size={24} color={Colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {quickAdds.length > 3 && (
                <TouchableOpacity
                  style={styles.disclosureButton}
                  onPress={() => setShowAllQuickAdds(value => !value)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAllQuickAdds }}
                >
                  <Text style={styles.disclosureButtonText}>
                    {showAllQuickAdds ? 'Show less' : `Show all ${quickAdds.length}`}
                  </Text>
                  <Ionicons
                    name={showAllQuickAdds ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={Colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.section}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              onPress={() => setShowManualForm(value => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showManualForm }}
            >
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionTitle}>Add Food Manually</Text>
                <Text style={styles.sectionSubtitle}>For meals that are not in Quick Add.</Text>
              </View>
              <Ionicons
                name={showManualForm ? 'remove-circle-outline' : 'add-circle-outline'}
                size={22}
                color={Colors.primary}
              />
            </TouchableOpacity>
            {showManualForm && (
              <View style={styles.manualForm}>
                <View style={styles.segmented}>
                  {MEALS.map(item => (
                    <TouchableOpacity
                      key={item}
                      style={[styles.segment, meal === item && styles.segmentActive]}
                      onPress={() => setMeal(item)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          meal === item && styles.segmentTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Food name"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={styles.input}
                  value={calories}
                  onChangeText={setCalories}
                  placeholder="Calories"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
                <View style={styles.macroInputGrid}>
                  <TextInput
                    style={[styles.input, styles.macroInput]}
                    value={protein}
                    onChangeText={setProtein}
                    placeholder="Protein"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.input, styles.macroInput]}
                    value={carbs}
                    onChangeText={setCarbs}
                    placeholder="Carbs"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.input, styles.macroInput]}
                    value={fat}
                    onChangeText={setFat}
                    placeholder="Fat"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.input, styles.macroInput]}
                    value={fiber}
                    onChangeText={setFiber}
                    placeholder="Fiber"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notes"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                />
                <TouchableOpacity
                  style={[styles.primaryButton, saving && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  <Ionicons name="save-outline" size={16} color={Colors.text} />
                  <Text style={styles.primaryButtonText}>
                    {saving ? 'Saving' : 'Save Food'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today’s Entries</Text>
            {todayEntries.length === 0 ? (
              <Text style={styles.emptyText}>No food logged today.</Text>
            ) : (
              todayEntries.map(entry => (
                <View key={entry.id} style={styles.foodRow}>
                  <View style={styles.foodIcon}>
                    <Ionicons name="restaurant-outline" size={16} color={Colors.primary} />
                  </View>
                  <View style={styles.foodBody}>
                    <Text style={styles.foodName}>{entry.name}</Text>
                    <Text style={styles.foodMeta}>
                      {entry.meal} · {entry.calories} kcal · {entry.proteinG}g protein ·{' '}
                      {entry.fiberG}g fiber
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => deleteNutritionEntry(entry.id)}
                    accessibilityLabel={`Delete ${entry.name}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionTitle}>Macro History</Text>
                <Text style={styles.sectionSubtitle}>
                  Averages use {macroAverages.loggedDays} logged {macroAverages.loggedDays === 1 ? 'day' : 'days'} · chart includes today.
                </Text>
              </View>
              <Ionicons name="calendar-outline" size={20} color={Colors.primary} />
            </View>
            <View style={styles.averageHero}>
              <Text style={styles.averageHeroValue}>{macroAverages.calories.toLocaleString()}</Text>
              <Text style={styles.averageLabel}>avg kcal</Text>
            </View>
            <View style={styles.averageGrid}>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.proteinG}g</Text>
                <Text style={styles.averageLabel}>avg protein</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.fiberG}g</Text>
                <Text style={styles.averageLabel}>avg fiber</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.carbsG}g</Text>
                <Text style={styles.averageLabel}>avg carbs</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.fatG}g</Text>
                <Text style={styles.averageLabel}>avg fat</Text>
              </View>
            </View>
            <View style={styles.historyList}>
              {macroHistory.map(day => (
                <View key={day.date} style={styles.historyRow}>
                  <View style={styles.historyHeading}>
                    <Text style={styles.historyDate}>
                      {day.date === today ? 'Today · in progress' : formatHistoryDate(day.date)}
                    </Text>
                    <Text style={styles.historyCalories}>{day.calories} kcal</Text>
                  </View>
                  <View style={styles.historyTrack}>
                    <View
                      style={[
                        styles.historyBar,
                        day.date === today && styles.historyBarToday,
                        { width: `${calorieHistoryScale.barPercent(day.calories) * 100}%` },
                      ]}
                    />
                    {calorieHistoryScale.targetPercent != null && (
                      <View
                        style={[
                          styles.historyTargetMarker,
                          { left: `${calorieHistoryScale.targetPercent * 100}%` },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={styles.historyMacros}>
                    P {Math.round(day.proteinG)}g · C {Math.round(day.carbsG)}g · F{' '}
                    {Math.round(day.fatG)}g · Fiber {Math.round(day.fiberG)}g
                    {day.entryCount === 0 ? ' · nothing logged' : ''}
                  </Text>
                </View>
              ))}
            </View>
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
  totalCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.base,
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  totalHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  totalLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  totalValue: {
    color: Colors.text,
    fontSize: FontSize.xxxl,
    fontWeight: '900',
  },
  totalTarget: {
    maxWidth: 144,
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textAlign: 'right',
  },
  goalTrack: {
    height: 8,
    backgroundColor: Colors.card,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  goalTrackSmall: {
    height: 5,
    backgroundColor: Colors.card,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  goalBar: {
    height: '100%',
    minWidth: 2,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
  },
  goalBarSuccess: { backgroundColor: Colors.success },
  goalGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  goalMetric: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  goalMetricHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  goalMetricLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  goalMetricValue: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '900',
  },
  goalMetricTarget: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  secondaryMacros: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  section: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '800',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sectionHeadingCopy: { flex: 1, gap: 2 },
  sectionSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  quickAddList: { gap: Spacing.sm },
  quickAddButton: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.inputBg,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  quickAddCopy: { flex: 1, gap: 3 },
  quickAddName: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '800',
  },
  quickAddMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textTransform: 'capitalize',
  },
  disclosureButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  disclosureButtonText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  collapsibleHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  manualForm: { gap: Spacing.md },
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
    textTransform: 'capitalize',
  },
  segmentTextActive: { color: Colors.primary },
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
  macroInputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  macroInput: {
    minWidth: '47%',
    flex: 1,
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
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomColor: Colors.separator,
    borderBottomWidth: 1,
  },
  foodIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryDim,
  },
  foodBody: { flex: 1, gap: 2 },
  foodName: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  foodMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textTransform: 'capitalize',
  },
  deleteButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  averageHero: {
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    gap: 2,
  },
  averageHeroValue: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '900',
  },
  averageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  averageTile: {
    minWidth: '47%',
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    gap: 2,
  },
  averageValue: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '900',
  },
  averageLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  historyList: { gap: Spacing.md },
  historyRow: { gap: Spacing.xs },
  historyHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyDate: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  historyCalories: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  historyTrack: {
    position: 'relative',
    height: 7,
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  historyBar: {
    height: '100%',
    minWidth: 2,
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
  },
  historyBarToday: { opacity: 0.55 },
  historyTargetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: Colors.textSecondary,
  },
  historyMacros: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
});
