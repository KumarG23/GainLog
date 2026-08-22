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
import { localDateKey, localIsoTimestamp } from '../../utils/date';
import {
  buildDailyMacroHistory,
  buildQuickAddFoods,
  type QuickAddFood,
} from '../../utils/nutritionMemory';

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
    loading,
    error,
    nutritionHealthConnectError,
    addNutritionEntry,
    deleteNutritionEntry,
    syncNutritionToHealthConnect,
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
  const [syncingNutrition, setSyncingNutrition] = useState(false);
  const [quickAdding, setQuickAdding] = useState<string | null>(null);
  const quickAddLock = useRef(false);

  const today = localDateKey();
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
  const macroHistory = useMemo(
    () => buildDailyMacroHistory(nutritionEntries, today, 7),
    [nutritionEntries, today],
  );
  const macroAverages = useMemo(
    () => ({
      calories: Math.round(
        macroHistory.reduce((sum, day) => sum + day.calories, 0) / macroHistory.length,
      ),
      proteinG: Math.round(
        macroHistory.reduce((sum, day) => sum + day.proteinG, 0) / macroHistory.length,
      ),
      carbsG: Math.round(
        macroHistory.reduce((sum, day) => sum + day.carbsG, 0) / macroHistory.length,
      ),
      fatG: Math.round(
        macroHistory.reduce((sum, day) => sum + day.fatG, 0) / macroHistory.length,
      ),
      fiberG: Math.round(
        macroHistory.reduce((sum, day) => sum + day.fiberG, 0) / macroHistory.length,
      ),
    }),
    [macroHistory],
  );
  const maxHistoryCalories = Math.max(1, ...macroHistory.map(day => day.calories));

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

  const handleNutritionSync = async () => {
    setSyncingNutrition(true);
    try {
      const written = await syncNutritionToHealthConnect();
      Alert.alert(
        'Nutrition synced',
        `Wrote ${written} GainLog meal${written === 1 ? '' : 's'} to Health Connect.`,
      );
    } catch (err) {
      Alert.alert(
        'Nutrition sync failed',
        err instanceof Error ? err.message : 'Unable to write nutrition to Health Connect.',
      );
    } finally {
      setSyncingNutrition(false);
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
            <View>
              <Text style={styles.totalLabel}>Today</Text>
              <Text style={styles.totalValue}>{totals.calories} kcal</Text>
            </View>
            <View style={styles.macroGrid}>
              <Text style={styles.macroText}>{totals.proteinG}g protein</Text>
              <Text style={styles.macroText}>{totals.carbsG}g carbs</Text>
              <Text style={styles.macroText}>{totals.fatG}g fat</Text>
              <Text style={styles.macroText}>{totals.fiberG}g fiber</Text>
            </View>
          </View>

          {Platform.OS === 'android' && (
            <TouchableOpacity
              style={[styles.primaryButton, syncingNutrition && styles.buttonDisabled]}
              onPress={handleNutritionSync}
              disabled={syncingNutrition}
              accessibilityLabel="Sync GainLog nutrition to Health Connect"
            >
              {syncingNutrition ? (
                <ActivityIndicator size="small" color={Colors.text} />
              ) : (
                <Ionicons name="sync-outline" size={16} color={Colors.text} />
              )}
              <Text style={styles.primaryButtonText}>
                {syncingNutrition ? 'Syncing nutrition' : 'Sync nutrition to Health Connect'}
              </Text>
            </TouchableOpacity>
          )}

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
                {quickAdds.map(food => {
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
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add Food</Text>
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
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={protein}
                onChangeText={setProtein}
                placeholder="Protein"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={carbs}
                onChangeText={setCarbs}
                placeholder="Carbs"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
                value={fat}
                onChangeText={setFat}
                placeholder="Fat"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.rowInput]}
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
                <Text style={styles.sectionSubtitle}>Rolling seven-day memory.</Text>
              </View>
              <Ionicons name="calendar-outline" size={20} color={Colors.primary} />
            </View>
            <View style={styles.averageGrid}>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.calories}</Text>
                <Text style={styles.averageLabel}>avg kcal</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.proteinG}g</Text>
                <Text style={styles.averageLabel}>avg protein</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.carbsG}g</Text>
                <Text style={styles.averageLabel}>avg carbs</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.fatG}g</Text>
                <Text style={styles.averageLabel}>avg fat</Text>
              </View>
              <View style={styles.averageTile}>
                <Text style={styles.averageValue}>{macroAverages.fiberG}g</Text>
                <Text style={styles.averageLabel}>avg fiber</Text>
              </View>
            </View>
            <View style={styles.historyList}>
              {macroHistory.map(day => (
                <View key={day.date} style={styles.historyRow}>
                  <View style={styles.historyHeading}>
                    <Text style={styles.historyDate}>
                      {day.date === today ? 'Today' : formatHistoryDate(day.date)}
                    </Text>
                    <Text style={styles.historyCalories}>{day.calories} kcal</Text>
                  </View>
                  <View style={styles.historyTrack}>
                    <View
                      style={[
                        styles.historyBar,
                        { width: `${(day.calories / maxHistoryCalories) * 100}%` },
                      ]}
                    />
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
    minHeight: 128,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.base,
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
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  macroText: {
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
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  rowInput: { flex: 1 },
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
  historyMacros: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
});
