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
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { NotificationTestButton } from '../../components/NotificationTestButton';
import { useHealth } from '../../context/HealthContext';
import { localDateKey, localIsoTimestamp } from '../../utils/date';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

function toNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function NutritionScreen() {
  const {
    nutritionEntries,
    dashboardSummary,
    loading,
    error,
    addNutritionEntry,
    deleteNutritionEntry,
  } = useHealth();

  const [meal, setMeal] = useState('breakfast');
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
        notes: notes.trim() || undefined,
      });
      setName('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
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

          <View style={styles.totalCard}>
            <View>
              <Text style={styles.totalLabel}>Today</Text>
              <Text style={styles.totalValue}>{totals.calories} kcal</Text>
            </View>
            <View style={styles.macroGrid}>
              <Text style={styles.macroText}>{totals.proteinG}g protein</Text>
              <Text style={styles.macroText}>{totals.carbsG}g carbs</Text>
              <Text style={styles.macroText}>{totals.fatG}g fat</Text>
            </View>
          </View>

          <NotificationTestButton />

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
                      {entry.meal} · {entry.calories} kcal · {entry.proteinG}g protein
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
});
