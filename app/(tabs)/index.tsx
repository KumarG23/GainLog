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
import { Href, useRouter } from 'expo-router';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useWorkouts } from '../../context/WorkoutsContext';
import { useHealth } from '../../context/HealthContext';
import { generateId } from '../../utils/id';
import { API_URL } from '../../constants/api';
import { Exercise, ExerciseKind } from '../../types/workout';
import { localDateKey, localIsoTimestamp } from '../../utils/date';
import {
  findPreviousExercise,
  formatPreviousExerciseSummary,
  getPreviousSetHint,
  PreviousSetHint,
} from '../../utils/workoutHistoryHints';
import {
  PLANET_FITNESS_TEMPLATES,
  buildWorkoutTemplateDraft,
  getSuggestedTemplateId,
  getWorkoutPlanWeekStart,
  WorkoutTemplateId,
} from '../../utils/workoutTemplates';

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
  kind: ExerciseKind;
  sets: DraftSet[];
  cardioDurationMinutes: string;
  distanceMiles: string;
  resistanceLevel: string;
  prescription?: string;
  recommendedWeight?: string;
}

function newSet(): DraftSet {
  return { id: generateId(), weight: '', reps: '' };
}

function newExercise(kind: ExerciseKind): DraftExercise {
  return {
    id: generateId(),
    name: kind === 'cardio' ? 'Elliptical' : '',
    kind,
    sets: kind === 'strength' ? [newSet()] : [],
    cardioDurationMinutes: '',
    distanceMiles: '',
    resistanceLevel: '',
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SetRowProps {
  set: DraftSet;
  index: number;
  previousHint: PreviousSetHint;
  recommendedWeight?: string;
  canDelete: boolean;
  onChangeWeight: (v: string) => void;
  onChangeReps: (v: string) => void;
  onDelete: () => void;
}

function SetRow({
  set,
  index,
  previousHint,
  recommendedWeight,
  canDelete,
  onChangeWeight,
  onChangeReps,
  onDelete,
}: SetRowProps) {
  return (
    <View style={styles.setRow}>
      <View style={styles.setBadge}>
        <Text style={styles.setBadgeText}>{index + 1}</Text>
      </View>

      <TextInput
        style={[styles.setInput, styles.weightInput]}
        value={set.weight}
        onChangeText={onChangeWeight}
        placeholder={recommendedWeight ?? previousHint.weight ?? '0'}
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
        placeholder={previousHint.reps ?? '0'}
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
  previousExercise?: Exercise;
  index: number;
  onUpdateName: (name: string) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, field: 'weight' | 'reps', value: string) => void;
  onUpdateCardio: (
    field: 'cardioDurationMinutes' | 'distanceMiles' | 'resistanceLevel',
    value: string,
  ) => void;
  onRemove: () => void;
}

function ExerciseCard({
  exercise,
  previousExercise,
  index,
  onUpdateName,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onUpdateCardio,
  onRemove,
}: ExerciseCardProps) {
  const previousSummary = formatPreviousExerciseSummary(previousExercise);

  return (
    <View style={styles.exerciseCard}>
      {/* Card header */}
      <View style={styles.exerciseCardHeader}>
        <View style={styles.exerciseNumberBadge}>
          <Text style={styles.exerciseNumberText}>{index + 1}</Text>
        </View>
        <View style={styles.exerciseHeading}>
          <TextInput
            style={styles.exerciseNameInput}
            value={exercise.name}
            onChangeText={onUpdateName}
            placeholder={exercise.kind === 'cardio' ? 'Cardio activity' : 'Exercise name'}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="done"
          />
          {exercise.prescription && (
            <Text style={styles.exercisePrescription}>{exercise.prescription}</Text>
          )}
          {previousSummary && (
            <Text style={styles.exerciseHistory}>{previousSummary}</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {exercise.kind === 'strength' ? (
        <>
          <View style={styles.setsHeaderRow}>
            <View style={styles.setBadge} />
            <Text style={[styles.setColumnLabel, styles.weightInput]}>LBS</Text>
            <View style={{ width: Spacing.base }} />
            <Text style={[styles.setColumnLabel, styles.repsInput]}>REPS</Text>
            <View style={{ width: 28 }} />
          </View>

          {exercise.sets.map((set, setIdx) => (
            <SetRow
              key={set.id}
              set={set}
              index={setIdx}
              previousHint={getPreviousSetHint(previousExercise, setIdx)}
              recommendedWeight={exercise.recommendedWeight}
              canDelete={exercise.sets.length > 1}
              onChangeWeight={v => onUpdateSet(set.id, 'weight', v)}
              onChangeReps={v => onUpdateSet(set.id, 'reps', v)}
              onDelete={() => onRemoveSet(set.id)}
            />
          ))}

          <TouchableOpacity style={styles.addSetBtn} onPress={onAddSet}>
            <Ionicons name="add" size={15} color={Colors.primary} />
            <Text style={styles.addSetText}>Add Set</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.cardioFields}>
          <View style={styles.cardioField}>
            <Text style={styles.cardioLabel}>MINUTES *</Text>
            <TextInput
              style={styles.cardioInput}
              value={exercise.cardioDurationMinutes}
              onChangeText={value => onUpdateCardio('cardioDurationMinutes', value)}
              placeholder="30"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.cardioField}>
            <Text style={styles.cardioLabel}>MILES</Text>
            <TextInput
              style={styles.cardioInput}
              value={exercise.distanceMiles}
              onChangeText={value => onUpdateCardio('distanceMiles', value)}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.cardioField}>
            <Text style={styles.cardioLabel}>RESISTANCE</Text>
            <TextInput
              style={styles.cardioInput}
              value={exercise.resistanceLevel}
              onChangeText={value => onUpdateCardio('resistanceLevel', value)}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
      )}
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
  const { sessions, loading: workoutsLoading, addSession, refresh } = useWorkouts();
  const { nutritionEntries, loading: healthLoading } = useHealth();
  const router = useRouter();

  const now = new Date();
  const dateKey = localDateKey(now);
  const loggedMeals = new Set(
    nutritionEntries
      .filter(entry => entry.date.startsWith(dateKey))
      .map(entry => entry.meal.toLowerCase()),
  );
  const missingDueMeals = [
    { meal: 'breakfast', dueHour: 9 },
    { meal: 'lunch', dueHour: 13 },
    { meal: 'dinner', dueHour: 19 },
  ]
    .filter(item => now.getHours() >= item.dueHour && !loggedMeals.has(item.meal))
    .map(item => item.meal);

  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [strengthDuration, setStrengthDuration] = useState('');
  const [strengthHeartRate, setStrengthHeartRate] = useState('');
  const [strengthCalories, setStrengthCalories] = useState('');
  const [cardioHeartRate, setCardioHeartRate] = useState('');
  const [cardioCalories, setCardioCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<WorkoutTemplateId | null>(null);

  const suggestedTemplateId = getSuggestedTemplateId(now.getDay());
  const planHistoryCutoff = getWorkoutPlanWeekStart(now);

  // -- Exercise mutations ---------------------------------------------------

  const addExercise = useCallback((kind: ExerciseKind) => {
    setExercises(prev => [...prev, newExercise(kind)]);
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

  const updateCardio = useCallback(
    (
      exerciseId: string,
      field: 'cardioDurationMinutes' | 'distanceMiles' | 'resistanceLevel',
      value: string,
    ) => {
      setExercises(prev =>
        prev.map(e => (e.id === exerciseId ? { ...e, [field]: value } : e)),
      );
    },
    [],
  );

  const loadTemplate = useCallback((templateId: WorkoutTemplateId) => {
    const applyTemplate = () => {
      const draft = buildWorkoutTemplateDraft(templateId, generateId, sessions, new Date());
      setExercises(draft.exercises);
      setSelectedTemplateId(draft.template.id);
      setStrengthDuration('');
      setStrengthHeartRate('');
      setStrengthCalories('');
      setCardioHeartRate('');
      setCardioCalories('');
    };

    if (exercises.length === 0) {
      applyTemplate();
      return;
    }

    Alert.alert(
      'Replace current draft?',
      'Loading a workout plan will replace the exercises currently on this screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: applyTemplate },
      ],
    );
  }, [exercises.length, sessions]);

  // -- Save -----------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (exercises.length === 0) {
      Alert.alert('No Exercises', 'Add at least one exercise before saving.');
      return;
    }

    const validExercises = exercises.filter(e =>
      e.name.trim() && (
        e.kind === 'cardio'
          ? parseInt(e.cardioDurationMinutes, 10) > 0
          : e.sets.some(s => s.reps.trim())
      ),
    );

    if (validExercises.length === 0) {
      Alert.alert(
        'Incomplete',
        'Strength exercises need reps. Cardio activities need a name and duration.',
      );
      return;
    }

    const hasStrength = validExercises.some(e => e.kind === 'strength');
    const hasCardio = validExercises.some(e => e.kind === 'cardio');
    const parsedStrengthDuration = parseInt(strengthDuration.trim(), 10);
    if (
      hasStrength &&
      (!strengthDuration.trim() || isNaN(parsedStrengthDuration) || parsedStrengthDuration <= 0)
    ) {
      Alert.alert('Strength Duration Required', 'Enter how many minutes strength training lasted.');
      return;
    }

    const cardioDuration = validExercises.reduce(
      (sum, exercise) =>
        exercise.kind === 'cardio'
          ? sum + (parseInt(exercise.cardioDurationMinutes, 10) || 0)
          : sum,
      0,
    );
    const totalDuration = (hasStrength ? parsedStrengthDuration : 0) + cardioDuration;
    const parsedStrengthHeartRate = strengthHeartRate.trim()
      ? parseInt(strengthHeartRate, 10)
      : undefined;
    const parsedCardioHeartRate = cardioHeartRate.trim()
      ? parseInt(cardioHeartRate, 10)
      : undefined;
    const parsedStrengthCalories = strengthCalories.trim()
      ? parseInt(strengthCalories, 10)
      : undefined;
    const parsedCardioCalories = cardioCalories.trim()
      ? parseInt(cardioCalories, 10)
      : undefined;
    const heartRateSegments = [
      hasStrength && parsedStrengthHeartRate != null
        ? { duration: parsedStrengthDuration, heartRate: parsedStrengthHeartRate }
        : null,
      hasCardio && parsedCardioHeartRate != null
        ? { duration: cardioDuration, heartRate: parsedCardioHeartRate }
        : null,
    ].filter((segment): segment is { duration: number; heartRate: number } => segment !== null);
    const heartRateDuration = heartRateSegments.reduce((sum, segment) => sum + segment.duration, 0);
    const combinedHeartRate = heartRateDuration > 0
      ? Math.round(
          heartRateSegments.reduce(
            (sum, segment) => sum + segment.duration * segment.heartRate,
            0,
          ) / heartRateDuration,
        )
      : undefined;
    const calorieValues = [parsedStrengthCalories, parsedCardioCalories].filter(
      (value): value is number => value != null,
    );

    setSaving(true);
    try {
      const session = await addSession({
        date: localIsoTimestamp(),
        durationMinutes: totalDuration,
        avgHeartRate: combinedHeartRate,
        activeCalories: calorieValues.length > 0
          ? calorieValues.reduce((sum, value) => sum + value, 0)
          : undefined,
        strengthSummary: hasStrength
          ? {
              durationMinutes: parsedStrengthDuration,
              avgHeartRate: parsedStrengthHeartRate,
              activeCalories: parsedStrengthCalories,
            }
          : undefined,
        cardioSummary: hasCardio
          ? {
              durationMinutes: cardioDuration,
              avgHeartRate: parsedCardioHeartRate,
              activeCalories: parsedCardioCalories,
            }
          : undefined,
        notes: notes.trim() || undefined,
        exercises: validExercises.map(e => ({
          id: e.id,
          name: e.name.trim(),
          kind: e.kind,
          sets: e.kind === 'strength'
            ? e.sets
                .filter(s => s.reps.trim())
                .map(s => ({
                  id: s.id,
                  weight: parseFloat(s.weight) || 0,
                  reps: parseInt(s.reps, 10) || 0,
                }))
            : [],
          cardioDurationMinutes: e.kind === 'cardio'
            ? parseInt(e.cardioDurationMinutes, 10)
            : undefined,
          distanceMiles: e.kind === 'cardio' && e.distanceMiles.trim()
            ? parseFloat(e.distanceMiles)
            : undefined,
          resistanceLevel: e.kind === 'cardio' && e.resistanceLevel.trim()
            ? parseFloat(e.resistanceLevel)
            : undefined,
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
  }, [
    exercises,
    strengthDuration,
    strengthHeartRate,
    strengthCalories,
    cardioHeartRate,
    cardioCalories,
    notes,
    addSession,
    refresh,
  ]);

  const resetForm = useCallback(() => {
    setExercises([]);
    setStrengthDuration('');
    setStrengthHeartRate('');
    setStrengthCalories('');
    setCardioHeartRate('');
    setCardioCalories('');
    setNotes('');
    setSaved(false);
    setInsight(null);
    setInsightLoading(false);
    setSelectedTemplateId(null);
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
  const hasStrengthExercises = exercises.some(exercise => exercise.kind === 'strength');
  const hasCardioExercises = exercises.some(exercise => exercise.kind === 'cardio');
  const draftCardioDuration = exercises.reduce(
    (sum, exercise) =>
      exercise.kind === 'cardio'
        ? sum + (parseInt(exercise.cardioDurationMinutes, 10) || 0)
        : sum,
    0,
  );

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

          {!healthLoading && missingDueMeals.length > 0 && (
            <TouchableOpacity
              style={styles.mealReminder}
              onPress={() => router.push('/nutrition' as Href)}
              accessibilityLabel="Log missing meals"
            >
              <View style={styles.mealReminderIcon}>
                <Ionicons name="restaurant-outline" size={18} color={Colors.warning} />
              </View>
              <View style={styles.mealReminderBody}>
                <Text style={styles.mealReminderTitle}>Meal log check</Text>
                <Text style={styles.mealReminderText}>
                  Still due: {missingDueMeals.join(', ')}
                </Text>
              </View>
              <Text style={styles.mealReminderAction}>Log food</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.warning} />
            </TouchableOpacity>
          )}

          <View style={styles.planSection}>
            <View style={styles.planHeader}>
              <View>
                <Text style={styles.planEyebrow}>PLANET FITNESS PLAN</Text>
                <Text style={styles.planTitle}>Adaptive weekly plan</Text>
              </View>
              <Ionicons name="calendar-outline" size={22} color={Colors.primary} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.planCards}
            >
              {PLANET_FITNESS_TEMPLATES.map(template => {
                const selected = selectedTemplateId === template.id;
                const suggested = suggestedTemplateId === template.id;
                return (
                  <TouchableOpacity
                    key={template.id}
                    disabled={workoutsLoading}
                    style={[
                      styles.planCard,
                      workoutsLoading && styles.planCardDisabled,
                      selected && styles.planCardSelected,
                    ]}
                    onPress={() => loadTemplate(template.id)}
                    activeOpacity={0.8}
                    accessibilityLabel={`Load ${template.weekday} ${template.title} workout`}
                  >
                    <View style={styles.planCardTopRow}>
                      <Text style={[styles.planDay, selected && styles.planTextSelected]}>
                        {template.weekday}
                      </Text>
                      {suggested && <Text style={styles.todayBadge}>TODAY</Text>}
                    </View>
                    <Text style={[styles.planCardTitle, selected && styles.planTextSelected]}>
                      {template.title}
                    </Text>
                    <Text style={styles.planFocus}>{template.focus}</Text>
                    <Text style={styles.planMeta}>
                      {template.id === 'recovery'
                        ? `Easy cardio · ~${template.estimatedMinutes} min`
                        : `${template.exercises.length} lifts · ~${template.estimatedMinutes} min`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.planHint}>
              {workoutsLoading
                ? 'Loading your workout history before generating this week’s plan…'
                : 'Each week uses your completed GainLog history from before Monday to recommend the next load. Enter what you actually complete. Wednesday is easy cardio only; elliptical counts as cardio, not step-equivalent mileage.'}
            </Text>
          </View>

          {/* Exercise cards */}
          {exercises.length === 0 ? (
            <View style={styles.emptyExercises}>
              <Ionicons name="barbell-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No exercises yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap &quot;Add Exercise&quot; to start building your session.
              </Text>
            </View>
          ) : (
            exercises.map((ex, idx) => (
              <ExerciseCard
                key={ex.id}
                exercise={ex}
                previousExercise={findPreviousExercise(
                  sessions,
                  ex.name,
                  ex.kind,
                  selectedTemplateId ? planHistoryCutoff : undefined,
                )}
                index={idx}
                onUpdateName={name => updateExerciseName(ex.id, name)}
                onAddSet={() => addSet(ex.id)}
                onRemoveSet={setId => removeSet(ex.id, setId)}
                onUpdateSet={(setId, field, value) =>
                  updateSet(ex.id, setId, field, value)
                }
                onUpdateCardio={(field, value) => updateCardio(ex.id, field, value)}
                onRemove={() => removeExercise(ex.id)}
              />
            ))
          )}

          <View style={styles.addExerciseRow}>
            <TouchableOpacity
              style={styles.addExerciseBtn}
              onPress={() => addExercise('strength')}
            >
              <Ionicons name="barbell-outline" size={18} color={Colors.primary} />
              <Text style={styles.addExerciseText}>Add Strength</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addExerciseBtn}
              onPress={() => addExercise('cardio')}
            >
              <Ionicons name="heart-outline" size={18} color={Colors.primary} />
              <Text style={styles.addExerciseText}>Add Cardio</Text>
            </TouchableOpacity>
          </View>

          {/* Separate activity summaries; one combined workout is saved below. */}
          {hasStrengthExercises && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Strength Session Info</Text>

              <View style={styles.metaRow}>
                <View style={[styles.metaIconWrap, { backgroundColor: Colors.primaryDim }]}>
                  <Ionicons name="time-outline" size={16} color={Colors.primary} />
                </View>
                <View style={styles.metaContent}>
                  <Text style={styles.metaLabel}>Duration (min) *</Text>
                  <TextInput
                    style={styles.metaInput}
                    value={strengthDuration}
                    onChangeText={setStrengthDuration}
                    placeholder="e.g. 45"
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
                    value={strengthHeartRate}
                    onChangeText={setStrengthHeartRate}
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
                    value={strengthCalories}
                    onChangeText={setStrengthCalories}
                    placeholder="Optional"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>
          )}

          {hasCardioExercises && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Cardio Session Info</Text>

              <View style={styles.metaRow}>
                <View style={[styles.metaIconWrap, { backgroundColor: Colors.primaryDim }]}>
                  <Ionicons name="time-outline" size={16} color={Colors.primary} />
                </View>
                <View style={styles.metaContent}>
                  <Text style={styles.metaLabel}>Duration</Text>
                  <Text style={styles.metaReadout}>
                    {draftCardioDuration > 0
                      ? `${draftCardioDuration} min from cardio activities`
                      : 'Enter minutes on the cardio activity'}
                  </Text>
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
                    value={cardioHeartRate}
                    onChangeText={setCardioHeartRate}
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
                    value={cardioCalories}
                    onChangeText={setCardioCalories}
                    placeholder="Optional"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>
          )}

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
  mealReminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  mealReminderIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealReminderBody: { flex: 1, gap: 2 },
  mealReminderTitle: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  mealReminderText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    textTransform: 'capitalize',
  },
  mealReminderAction: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontWeight: '800',
  },

  // Workout plan templates
  planSection: {
    marginBottom: Spacing.lg,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  planEyebrow: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  planTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '800',
    marginTop: 2,
  },
  planCards: {
    gap: Spacing.sm,
    paddingRight: Spacing.base,
  },
  planCard: {
    width: 168,
    minHeight: 132,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  planCardDisabled: {
    opacity: 0.5,
  },
  planCardSelected: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  planCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  planDay: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  todayBadge: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  planCardTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '800',
    marginTop: Spacing.sm,
  },
  planTextSelected: { color: Colors.primary },
  planFocus: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
    marginTop: Spacing.xs,
  },
  planMeta: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: 'auto',
    paddingTop: Spacing.sm,
  },
  planHint: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    lineHeight: 16,
    marginTop: Spacing.sm,
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
  exerciseHeading: {
    flex: 1,
    gap: 2,
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
    fontSize: FontSize.base,
    fontWeight: '600',
    color: Colors.text,
  },
  exercisePrescription: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  exerciseHistory: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '500',
  },
  cardioFields: {
    padding: Spacing.base,
    gap: Spacing.md,
  },
  cardioField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cardioLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  cardioInput: {
    minWidth: 110,
    backgroundColor: Colors.card,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: '600',
    textAlign: 'right',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
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
  addExerciseRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  addExerciseBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    paddingVertical: Spacing.base,
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
  metaReadout: {
    flexShrink: 1,
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
    textAlign: 'right',
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
