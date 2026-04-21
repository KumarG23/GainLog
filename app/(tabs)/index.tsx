import React, { useCallback, useState } from 'react';
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
import { useWorkouts } from '../../context/WorkoutsContext';
import { generateId } from '../../utils/id';
import { API_URL } from '../../constants/api';

// ---------------------------------------------------------------------------
// Draft types (strings for inputs, converted on save)
// ---------------------------------------------------------------------------

interface DraftSet {
  id: string;
  weight: string;
  reps: string;
}

interface DraftExercise {
  id: string;
  name: string;
  sets: DraftSet[];
}

function newSet(): DraftSet {
  return { id: generateId(), weight: '', reps: '' };
}

function newExercise(): DraftExercise {
  return { id: generateId(), name: '', sets: [newSet()] };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SetRowProps {
  set: DraftSet;
  index: number;
  canDelete: boolean;
  onChangeWeight: (v: string) => void;
  onChangeReps: (v: string) => void;
  onDelete: () => void;
}

function SetRow({ set, index, canDelete, onChangeWeight, onChangeReps, onDelete }: SetRowProps) {
  return (
    <View style={styles.setRow}>
      <View style={styles.setBadge}>
        <Text style={styles.setBadgeText}>{index + 1}</Text>
      </View>

      <TextInput
        style={[styles.setInput, styles.weightInput]}
        value={set.weight}
        onChangeText={onChangeWeight}
        placeholder="0"
        placeholderTextColor={Colors.textMuted}
        keyboardType="decimal-pad"
        returnKeyType="next"
        selectTextOnFocus
      />

      <Text style={styles.setMultiplier}>×</Text>

      <TextInput
        style={[styles.setInput, styles.repsInput]}
        value={set.reps}
        onChangeText={onChangeReps}
        placeholder="0"
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
      />

      <TouchableOpacity
        style={styles.setDeleteBtn}
        onPress={onDelete}
        disabled={!canDelete}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name="remove-circle-outline"
          size={20}
          color={canDelete ? Colors.danger : Colors.cardBorder}
        />
      </TouchableOpacity>
    </View>
  );
}

interface ExerciseCardProps {
  exercise: DraftExercise;
  index: number;
  onUpdateName: (name: string) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, field: 'weight' | 'reps', value: string) => void;
  onRemove: () => void;
}

function ExerciseCard({
  exercise,
  index,
  onUpdateName,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onRemove,
}: ExerciseCardProps) {
  return (
    <View style={styles.exerciseCard}>
      {/* Card header */}
      <View style={styles.exerciseCardHeader}>
        <View style={styles.exerciseNumberBadge}>
          <Text style={styles.exerciseNumberText}>{index + 1}</Text>
        </View>
        <TextInput
          style={styles.exerciseNameInput}
          value={exercise.name}
          onChangeText={onUpdateName}
          placeholder="Exercise name"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="done"
        />
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Sets header */}
      <View style={styles.setsHeaderRow}>
        <View style={styles.setBadge} />
        <Text style={[styles.setColumnLabel, styles.weightInput]}>LBS</Text>
        <View style={{ width: Spacing.base }} />
        <Text style={[styles.setColumnLabel, styles.repsInput]}>REPS</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Set rows */}
      {exercise.sets.map((set, setIdx) => (
        <SetRow
          key={set.id}
          set={set}
          index={setIdx}
          canDelete={exercise.sets.length > 1}
          onChangeWeight={v => onUpdateSet(set.id, 'weight', v)}
          onChangeReps={v => onUpdateSet(set.id, 'reps', v)}
          onDelete={() => onRemoveSet(set.id)}
        />
      ))}

      {/* Add set */}
      <TouchableOpacity style={styles.addSetBtn} onPress={onAddSet}>
        <Ionicons name="add" size={15} color={Colors.primary} />
        <Text style={styles.addSetText}>Add Set</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------

interface SuccessViewProps {
  onReset: () => void;
  insightLoading: boolean;
  insight: string | null;
}

function SuccessView({ onReset, insightLoading, insight }: SuccessViewProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.successContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.successIconRing}>
          <Ionicons name="checkmark-circle" size={72} color={Colors.success} />
        </View>
        <Text style={styles.successTitle}>Workout Logged</Text>
        <Text style={styles.successSubtitle}>
          Great work. Your session has been saved.
        </Text>

        {(insightLoading || insight !== null) && (
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <Ionicons name="sparkles" size={13} color={Colors.primary} />
              <Text style={styles.insightLabel}>AI Coaching Insight</Text>
            </View>
            {insightLoading ? (
              <View style={styles.insightLoading}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.insightLoadingText}>Analyzing your workout…</Text>
              </View>
            ) : (
              <Text style={styles.insightText}>{insight}</Text>
            )}
          </View>
        )}

        <TouchableOpacity style={styles.newWorkoutBtn} onPress={onReset}>
          <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.newWorkoutBtnText}>Log Another Workout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function LogScreen() {
  const { addSession, refresh } = useWorkouts();

  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [duration, setDuration] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  // -- Exercise mutations ---------------------------------------------------

  const addExercise = useCallback(() => {
    setExercises(prev => [...prev, newExercise()]);
  }, []);

  const removeExercise = useCallback((id: string) => {
    setExercises(prev => prev.filter(e => e.id !== id));
  }, []);

  const updateExerciseName = useCallback((id: string, name: string) => {
    setExercises(prev =>
      prev.map(e => (e.id === id ? { ...e, name } : e)),
    );
  }, []);

  const addSet = useCallback((exerciseId: string) => {
    setExercises(prev =>
      prev.map(e =>
        e.id === exerciseId ? { ...e, sets: [...e.sets, newSet()] } : e,
      ),
    );
  }, []);

  const removeSet = useCallback((exerciseId: string, setId: string) => {
    setExercises(prev =>
      prev.map(e =>
        e.id === exerciseId
          ? { ...e, sets: e.sets.filter(s => s.id !== setId) }
          : e,
      ),
    );
  }, []);

  const updateSet = useCallback(
    (exerciseId: string, setId: string, field: 'weight' | 'reps', value: string) => {
      setExercises(prev =>
        prev.map(e =>
          e.id === exerciseId
            ? {
                ...e,
                sets: e.sets.map(s =>
                  s.id === setId ? { ...s, [field]: value } : s,
                ),
              }
            : e,
        ),
      );
    },
    [],
  );

  // -- Save -----------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (exercises.length === 0) {
      Alert.alert('No Exercises', 'Add at least one exercise before saving.');
      return;
    }

    const validExercises = exercises.filter(
      e => e.name.trim() && e.sets.some(s => s.reps.trim()),
    );

    if (validExercises.length === 0) {
      Alert.alert(
        'Incomplete',
        'Each exercise needs a name and at least one set with reps entered.',
      );
      return;
    }

    const parsedDuration = parseInt(duration.trim(), 10);
    if (!duration.trim() || isNaN(parsedDuration) || parsedDuration <= 0) {
      Alert.alert('Duration Required', 'Enter how many minutes the workout lasted.');
      return;
    }

    setSaving(true);
    try {
      const session = await addSession({
        date: new Date().toISOString(),
        durationMinutes: parsedDuration,
        avgHeartRate: heartRate.trim() ? parseInt(heartRate, 10) : undefined,
        activeCalories: calories.trim() ? parseInt(calories, 10) : undefined,
        notes: notes.trim() || undefined,
        exercises: validExercises.map(e => ({
          id: e.id,
          name: e.name.trim(),
          sets: e.sets
            .filter(s => s.reps.trim())
            .map(s => ({
              id: s.id,
              weight: parseFloat(s.weight) || 0,
              reps: parseInt(s.reps, 10) || 0,
            })),
        })),
      });
      setSaved(true);
      // Fetch insight in the background — failure is silent so success screen always shows
      setInsightLoading(true);
      fetch(`${API_URL}/workouts/${session.id}/insight`, { method: 'POST' })
        .then(res => {
          if (!res.ok) throw new Error('insight request failed');
          return res.json() as Promise<{ insight: string }>;
        })
        .then(data => {
          setInsight(data.insight);
          refresh();
        })
        .catch(() => {/* don't surface — success screen still shows */})
        .finally(() => setInsightLoading(false));
    } finally {
      setSaving(false);
    }
  }, [exercises, duration, heartRate, calories, notes, addSession, refresh]);

  const resetForm = useCallback(() => {
    setExercises([]);
    setDuration('');
    setHeartRate('');
    setCalories('');
    setNotes('');
    setSaved(false);
    setInsight(null);
    setInsightLoading(false);
  }, []);

  // -------------------------------------------------------------------------

  if (saved) {
    return (
      <SuccessView
        onReset={resetForm}
        insightLoading={insightLoading}
        insight={insight}
      />
    );
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Date banner */}
          <View style={styles.dateBanner}>
            <Text style={styles.dateText}>{today}</Text>
          </View>

          {/* Exercise cards */}
          {exercises.length === 0 ? (
            <View style={styles.emptyExercises}>
              <Ionicons name="barbell-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No exercises yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap "Add Exercise" to start building your session.
              </Text>
            </View>
          ) : (
            exercises.map((ex, idx) => (
              <ExerciseCard
                key={ex.id}
                exercise={ex}
                index={idx}
                onUpdateName={name => updateExerciseName(ex.id, name)}
                onAddSet={() => addSet(ex.id)}
                onRemoveSet={setId => removeSet(ex.id, setId)}
                onUpdateSet={(setId, field, value) =>
                  updateSet(ex.id, setId, field, value)
                }
                onRemove={() => removeExercise(ex.id)}
              />
            ))
          )}

          {/* Add exercise button */}
          <TouchableOpacity style={styles.addExerciseBtn} onPress={addExercise}>
            <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
            <Text style={styles.addExerciseText}>Add Exercise</Text>
          </TouchableOpacity>

          {/* Session metadata */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Session Info</Text>

            <View style={styles.metaRow}>
              <View style={[styles.metaIconWrap, { backgroundColor: Colors.primaryDim }]}>
                <Ionicons name="time-outline" size={16} color={Colors.primary} />
              </View>
              <View style={styles.metaContent}>
                <Text style={styles.metaLabel}>Duration (min) *</Text>
                <TextInput
                  style={styles.metaInput}
                  value={duration}
                  onChangeText={setDuration}
                  placeholder="e.g. 60"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.metaDivider} />

            <View style={styles.metaRow}>
              <View style={[styles.metaIconWrap, { backgroundColor: Colors.dangerDim }]}>
                <Ionicons name="heart-outline" size={16} color={Colors.danger} />
              </View>
              <View style={styles.metaContent}>
                <Text style={styles.metaLabel}>Avg Heart Rate (bpm)</Text>
                <TextInput
                  style={styles.metaInput}
                  value={heartRate}
                  onChangeText={setHeartRate}
                  placeholder="Optional"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.metaDivider} />

            <View style={styles.metaRow}>
              <View style={[styles.metaIconWrap, { backgroundColor: Colors.warningDim }]}>
                <Ionicons name="flame-outline" size={16} color={Colors.warning} />
              </View>
              <View style={styles.metaContent}>
                <Text style={styles.metaLabel}>Active Calories</Text>
                <TextInput
                  style={styles.metaInput}
                  value={calories}
                  onChangeText={setCalories}
                  placeholder="Optional"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="How did it go? PRs, form notes, anything..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Save */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Ionicons
              name={saving ? 'hourglass-outline' : 'checkmark-circle'}
              size={20}
              color="#fff"
            />
            <Text style={styles.saveBtnText}>
              {saving ? 'Saving…' : 'Complete Workout'}
            </Text>
          </TouchableOpacity>

          <View style={{ height: Spacing.xxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingHorizontal: Spacing.base, paddingTop: Spacing.md },

  // Date banner
  dateBanner: { marginBottom: Spacing.lg },
  dateText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Empty state
  emptyExercises: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },

  // Exercise card
  exerciseCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  exerciseNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNumberText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
  },
  exerciseNameInput: {
    flex: 1,
    fontSize: FontSize.base,
    fontWeight: '600',
    color: Colors.text,
  },

  // Sets header
  setsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  setColumnLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textAlign: 'center',
  },

  // Set row
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs + 2,
    gap: Spacing.sm,
  },
  setBadge: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  setInput: {
    height: 40,
    backgroundColor: Colors.card,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: Spacing.xs,
  },
  weightInput: { width: 72 },
  repsInput: { width: 56 },
  setMultiplier: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontWeight: '500',
    width: Spacing.base,
    textAlign: 'center',
  },
  setDeleteBtn: {
    width: 28,
    alignItems: 'center',
  },

  // Add set
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  addSetText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },

  // Add exercise
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    paddingVertical: Spacing.base,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  addExerciseText: {
    fontSize: FontSize.base,
    fontWeight: '600',
    color: Colors.primary,
  },

  // Section card
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    padding: Spacing.base,
  },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
  },

  // Meta rows
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  metaIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLabel: {
    fontSize: FontSize.base,
    color: Colors.text,
    fontWeight: '500',
  },
  metaInput: {
    fontSize: FontSize.base,
    color: Colors.primary,
    fontWeight: '600',
    textAlign: 'right',
    minWidth: 80,
    paddingVertical: Spacing.xs,
  },
  metaDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
  },

  // Notes
  notesInput: {
    fontSize: FontSize.base,
    color: Colors.text,
    minHeight: 80,
    lineHeight: 22,
  },

  // Save button
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.base + 2,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },

  // Success
  successContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  successIconRing: {
    marginBottom: Spacing.md,
  },
  successTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  newWorkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  newWorkoutBtnText: {
    fontSize: FontSize.base,
    fontWeight: '600',
    color: Colors.primary,
  },

  // AI insight card
  insightCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginTop: Spacing.md,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  insightLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  insightLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  insightLoadingText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  insightText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
});
