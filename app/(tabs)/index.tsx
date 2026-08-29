import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
import * as Haptics from 'expo-haptics';
import { Href, useRouter } from 'expo-router';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useWorkouts } from '../../context/WorkoutsContext';
import { useHealth } from '../../context/HealthContext';
import { generateId } from '../../utils/id';
import { API_URL } from '../../constants/api';
import { CoachInsight, Exercise, ExerciseKind, WorkoutEffort, WorkoutSession } from '../../types/workout';
import { CoachInsightCard } from '../../components/CoachInsightCard';
import { localDateKey, localIsoTimestamp } from '../../utils/date';
import {
  findPreviousExercise,
  formatPreviousExerciseSummary,
  getPreviousSetHint,
  PreviousSetHint,
} from '../../utils/workoutHistoryHints';
import {
  findPersonalRecordsForSession,
  findSuspiciousStrengthSets,
  PersonalRecord,
  SetPersonalRecord,
} from '../../utils/workoutRecords';
import {
  PLANET_FITNESS_TEMPLATES,
  buildWorkoutTemplateDraft,
  canLoadWorkoutTemplate,
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

const workoutEffortOptions: readonly { label: string; value: WorkoutEffort }[] = [
  { label: 'Easy', value: 'easy' },
  { label: 'About right', value: 'right' },
  { label: 'Hard', value: 'hard' },
];

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

function formatRecordLabel(record: PersonalRecord): string {
  return record.kind === 'weight'
    ? `Weight PR · ${record.weight} lb × ${record.reps}`
    : `Rep PR · ${record.reps} at ${record.weight} lb`;
}

function confirmSuspiciousEntries(exercises: readonly DraftExercise[]): Promise<boolean> {
  const suspicious = findSuspiciousStrengthSets(exercises);
  if (suspicious.length === 0) return Promise.resolve(true);

  const preview = suspicious
    .slice(0, 3)
    .map(entry => `${entry.exerciseName || 'Unnamed exercise'}: ${entry.weight} lb × ${entry.reps}`)
    .join('\n');
  const remaining = suspicious.length > 3 ? `\n…and ${suspicious.length - 3} more` : '';

  const message = `${preview}${remaining}\n\nMore than 40 reps is unusual. Review it, or confirm that the number is intentional. Confirmed outliers are saved but never count toward PRs or progression.`;

  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`Possible typo\n\n${message}`));
  }

  return new Promise(resolve => {
    Alert.alert(
      'Possible typo',
      message,
      [
        { text: 'Review', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Save Anyway', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SetRowProps {
  set: DraftSet;
  index: number;
  previousHint: PreviousSetHint;
  recommendedWeight?: string;
  record?: PersonalRecord;
  canDelete: boolean;
  onChangeWeight: (v: string) => void;
  onChangeReps: (v: string) => void;
  onComplete: () => void;
  onDelete: () => void;
}

function SetRow({
  set,
  index,
  previousHint,
  recommendedWeight,
  record,
  canDelete,
  onChangeWeight,
  onChangeReps,
  onComplete,
  onDelete,
}: SetRowProps) {
  return (
    <View style={styles.setRowBlock}>
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
          onBlur={onComplete}
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
      {record && (
        <View style={styles.prSetBadge}>
          <Ionicons name="trophy" size={12} color={Colors.warning} />
          <Text style={styles.prSetBadgeText}>{formatRecordLabel(record)}</Text>
        </View>
      )}
    </View>
  );
}

interface ExerciseCardProps {
  exercise: DraftExercise;
  previousExercise?: Exercise;
  recordsBySetId: ReadonlyMap<string, SetPersonalRecord>;
  index: number;
  onUpdateName: (name: string) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, field: 'weight' | 'reps', value: string) => void;
  onCompleteSet: (set: DraftSet) => void;
  onUpdateCardio: (
    field: 'cardioDurationMinutes' | 'distanceMiles' | 'resistanceLevel',
    value: string,
  ) => void;
  onRemove: () => void;
}

function ExerciseCard({
  exercise,
  previousExercise,
  recordsBySetId,
  index,
  onUpdateName,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onCompleteSet,
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
              record={recordsBySetId.get(set.id)}
              canDelete={exercise.sets.length > 1}
              onChangeWeight={v => onUpdateSet(set.id, 'weight', v)}
              onChangeReps={v => onUpdateSet(set.id, 'reps', v)}
              onComplete={() => onCompleteSet(set)}
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

function PrCelebration({ record, onDone }: { record: PersonalRecord; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.72)).current;

  useEffect(() => {
    opacity.setValue(0);
    scale.setValue(0.72);
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          damping: 7,
          stiffness: 190,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1250),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [onDone, opacity, scale, record]);

  return (
    <View style={styles.prOverlay} pointerEvents="none">
      <Animated.View style={[styles.prCelebration, { opacity, transform: [{ scale }] }]}>
        <Text style={[styles.prSpark, styles.prSparkTopLeft]}>✦</Text>
        <Text style={[styles.prSpark, styles.prSparkTopRight]}>★</Text>
        <Text style={[styles.prSpark, styles.prSparkBottomLeft]}>★</Text>
        <Text style={[styles.prSpark, styles.prSparkBottomRight]}>✦</Text>
        <View style={styles.prTrophyRing}>
          <Ionicons name="trophy" size={34} color={Colors.warning} />
        </View>
        <Text style={styles.prCelebrationEyebrow}>NEW PERSONAL RECORD</Text>
        <Text style={styles.prCelebrationTitle}>{record.exerciseName}</Text>
        <Text style={styles.prCelebrationValue}>{formatRecordLabel(record)}</Text>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------

interface SuccessViewProps {
  onReset: () => void;
  insightLoading: boolean;
  insightError: string | null;
  session: WorkoutSession;
  records: readonly SetPersonalRecord[];
  onFeedback: (feedback: { effort?: WorkoutEffort; pain?: boolean }) => Promise<void>;
}

function SuccessView({
  onReset,
  insightLoading,
  insightError,
  session,
  records,
  onFeedback,
}: SuccessViewProps) {
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

        {records.length > 0 && (
          <View style={styles.successPrCard}>
            <View style={styles.successPrHeader}>
              <Ionicons name="sparkles" size={18} color={Colors.warning} />
              <Text style={styles.successPrTitle}>
                {records.length} personal record{records.length === 1 ? '' : 's'}
              </Text>
            </View>
            {records.map(record => (
              <View key={`${record.setId}:${record.kind}`} style={styles.successPrRow}>
                <Ionicons name="trophy" size={14} color={Colors.warning} />
                <View style={styles.successPrCopy}>
                  <Text style={styles.successPrExercise}>{record.exerciseName}</Text>
                  <Text style={styles.successPrValue}>{formatRecordLabel(record)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {(insightLoading || insightError || session.coachInsight || session.insight) && (
          <CoachInsightCard
            session={session}
            loading={insightLoading}
            error={insightError}
            onFeedback={onFeedback}
          />
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
  const {
    sessions,
    loading: workoutsLoading,
    error: workoutsError,
    addSession,
    updateFeedback,
    refresh,
  } = useWorkouts();
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
  const [effort, setEffort] = useState<WorkoutEffort | null>(null);
  const [pain, setPain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedSession, setSavedSession] = useState<WorkoutSession | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const insightRequestSessionId = useRef<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<WorkoutTemplateId | null>(null);
  const [recordsBySetId, setRecordsBySetId] = useState<Map<string, SetPersonalRecord>>(
    () => new Map(),
  );
  const [activeCelebration, setActiveCelebration] = useState<PersonalRecord | null>(null);
  const celebratedRecordKeys = useRef(new Set<string>());
  const dismissCelebration = useCallback(() => setActiveCelebration(null), []);

  const suggestedTemplateId = getSuggestedTemplateId(now.getDay());
  const planHistoryCutoff = getWorkoutPlanWeekStart(now);
  const canLoadTemplate = canLoadWorkoutTemplate(workoutsLoading, workoutsError);
  const planScrollRef = useRef<ScrollView>(null);
  const positionedSuggestedTemplate = useRef<WorkoutTemplateId | null>(null);
  const handlePlanContentSizeChange = useCallback(() => {
    if (!suggestedTemplateId || positionedSuggestedTemplate.current === suggestedTemplateId) return;
    const index = PLANET_FITNESS_TEMPLATES.findIndex(template => template.id === suggestedTemplateId);
    if (index > 0) {
      planScrollRef.current?.scrollTo({ x: index * (168 + Spacing.sm), animated: false });
    }
    positionedSuggestedTemplate.current = suggestedTemplateId;
  }, [suggestedTemplateId]);

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
      setRecordsBySetId(current => {
        if (!current.has(setId)) return current;
        const next = new Map(current);
        next.delete(setId);
        return next;
      });
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

  const completeSet = useCallback((set: DraftSet) => {
    const draftSession: WorkoutSession = {
      id: 'active-draft',
      date: new Date().toISOString(),
      durationMinutes: 0,
      exercises: exercises.map(draftExercise => ({
        id: draftExercise.id,
        name: draftExercise.name,
        kind: draftExercise.kind,
        sets: draftExercise.kind === 'strength'
          ? draftExercise.sets.map(draftSet => ({
              id: draftSet.id,
              weight: Number.parseFloat(draftSet.weight) || 0,
              reps: Number.parseInt(draftSet.reps, 10) || 0,
            }))
          : [],
        cardioDurationMinutes: draftExercise.kind === 'cardio'
          ? Number.parseInt(draftExercise.cardioDurationMinutes, 10) || undefined
          : undefined,
      })),
    };
    const records = findPersonalRecordsForSession(sessions, draftSession);
    const nextRecords = new Map(records.map(record => [record.setId, record]));
    const record = nextRecords.get(set.id);

    setRecordsBySetId(nextRecords);

    if (!record) return;
    const celebrationKey = `${set.id}:${record.kind}:${record.weight}:${record.reps}`;
    if (celebratedRecordKeys.current.has(celebrationKey)) return;

    celebratedRecordKeys.current.add(celebrationKey);
    setActiveCelebration(record);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [exercises, sessions]);

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
    if (!canLoadTemplate) return;

    const applyTemplate = () => {
      const draft = buildWorkoutTemplateDraft(templateId, generateId, sessions, new Date());
      setExercises(draft.exercises);
      setSelectedTemplateId(draft.template.id);
      setStrengthDuration('');
      setStrengthHeartRate('');
      setStrengthCalories('');
      setCardioHeartRate('');
      setCardioCalories('');
      setRecordsBySetId(new Map());
      setActiveCelebration(null);
      celebratedRecordKeys.current.clear();
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
  }, [canLoadTemplate, exercises.length, sessions]);

  // -- Save -----------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (exercises.length === 0) {
      Alert.alert('No Exercises', 'Add at least one exercise before saving.');
      return;
    }

    if (!effort) {
      Alert.alert(
        'Workout Effort Required',
        'Choose Easy, About right, or Hard for the workout as a whole.',
      );
      return;
    }

    if (!notes.trim()) {
      Alert.alert(
        'Workout Notes Required',
        'Add a short note about strength, form, fatigue, substitutions, or pain.',
      );
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

    if (!(await confirmSuspiciousEntries(validExercises))) return;

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
        totalCalories: calorieValues.length > 0
          ? calorieValues.reduce((sum, value) => sum + value, 0)
          : undefined,
        strengthSummary: hasStrength
          ? {
              durationMinutes: parsedStrengthDuration,
              avgHeartRate: parsedStrengthHeartRate,
              totalCalories: parsedStrengthCalories,
            }
          : undefined,
        cardioSummary: hasCardio
          ? {
              durationMinutes: cardioDuration,
              avgHeartRate: parsedCardioHeartRate,
              totalCalories: parsedCardioCalories,
            }
          : undefined,
        notes: notes.trim(),
        templateId: selectedTemplateId ?? undefined,
        effort,
        pain,
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
      setSavedSession(session);
      setSaved(true);
      setInsightError(null);
      setInsightLoading(true);
      insightRequestSessionId.current = session.id;
      fetch(`${API_URL}/workouts/${session.id}/insight`, { method: 'POST' })
        .then(res => {
          if (!res.ok) throw new Error('insight request failed');
          return res.json() as Promise<{ insight: string; coachInsight: CoachInsight }>;
        })
        .then(data => {
          if (insightRequestSessionId.current !== session.id) return;
          setSavedSession(current => current
            && current.id === session.id
            ? { ...current, insight: data.insight, coachInsight: data.coachInsight }
            : current);
          refresh();
        })
        .catch(() => {
          if (insightRequestSessionId.current === session.id) {
            setInsightError('Coach insight is unavailable right now. Your workout is still saved.');
          }
        })
        .finally(() => {
          if (insightRequestSessionId.current === session.id) {
            insightRequestSessionId.current = null;
            setInsightLoading(false);
          }
        });
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
    effort,
    pain,
    selectedTemplateId,
    addSession,
    refresh,
  ]);

  const resetForm = useCallback(() => {
    insightRequestSessionId.current = null;
    setExercises([]);
    setStrengthDuration('');
    setStrengthHeartRate('');
    setStrengthCalories('');
    setCardioHeartRate('');
    setCardioCalories('');
    setNotes('');
    setEffort(null);
    setPain(false);
    setSaved(false);
    setSavedSession(null);
    setInsightLoading(false);
    setInsightError(null);
    setSelectedTemplateId(null);
    setRecordsBySetId(new Map());
    setActiveCelebration(null);
    celebratedRecordKeys.current.clear();
  }, []);

  const savedRecords = useMemo(
    () => savedSession ? findPersonalRecordsForSession(sessions, savedSession) : [],
    [savedSession, sessions],
  );

  // -------------------------------------------------------------------------

  if (saved && savedSession) {
    return (
      <SuccessView
        onReset={resetForm}
        insightLoading={insightLoading}
        insightError={insightError}
        session={savedSession}
        records={savedRecords}
        onFeedback={async feedback => {
          const updated = await updateFeedback(savedSession.id, feedback);
          setSavedSession(updated);
        }}
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
                <Text style={styles.planTitle}>
                  {suggestedTemplateId ? "Today's workout" : 'Adaptive weekly plan'}
                </Text>
              </View>
              <Ionicons name="calendar-outline" size={22} color={Colors.primary} />
            </View>
            {workoutsError && (
              <View style={styles.planError}>
                <Ionicons name="warning-outline" size={18} color={Colors.warning} />
                <View style={styles.planErrorBody}>
                  <Text style={styles.planErrorTitle}>Workout history unavailable</Text>
                  <Text style={styles.planErrorText}>
                    Recommendations are locked so missing history cannot look like a clean baseline.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.planRetryButton}
                  onPress={() => void refresh()}
                  accessibilityRole="button"
                  accessibilityLabel="Retry workout history"
                >
                  <Text style={styles.planRetryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            <ScrollView
              ref={planScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.planCards}
              onContentSizeChange={handlePlanContentSizeChange}
            >
              {PLANET_FITNESS_TEMPLATES.map(template => {
                const selected = selectedTemplateId === template.id;
                const suggested = suggestedTemplateId === template.id;
                return (
                  <TouchableOpacity
                    key={template.id}
                    disabled={!canLoadTemplate}
                    style={[
                      styles.planCard,
                      !canLoadTemplate && styles.planCardDisabled,
                      suggested && styles.planCardSuggested,
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
                : workoutsError
                  ? 'Retry workout history before loading a plan. Your saved workouts remain intact.'
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
                recordsBySetId={recordsBySetId}
                index={idx}
                onUpdateName={name => updateExerciseName(ex.id, name)}
                onAddSet={() => addSet(ex.id)}
                onRemoveSet={setId => removeSet(ex.id, setId)}
                onUpdateSet={(setId, field, value) =>
                  updateSet(ex.id, setId, field, value)
                }
                onCompleteSet={completeSet}
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
                  <Text style={styles.metaLabel}>Total Calories</Text>
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
                  <Text style={styles.metaLabel}>Total Calories</Text>
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

          {/* Required once per workout, not once per set. */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Workout Check-in</Text>
            <Text style={styles.checkInHint}>
              Required once per workout. Rate the session as a whole, then leave a useful note.
            </Text>
            <Text style={styles.checkInLabel}>Overall effort *</Text>
            <View style={styles.checkInEffortRow}>
              {workoutEffortOptions.map(option => {
                const selected = effort === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.checkInEffortButton,
                      selected && styles.checkInEffortButtonSelected,
                    ]}
                    onPress={() => setEffort(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[
                      styles.checkInEffortText,
                      selected && styles.checkInEffortTextSelected,
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.checkInPainButton, pain && styles.checkInPainButtonSelected]}
              onPress={() => setPain(current => !current)}
              accessibilityRole="button"
              accessibilityState={{ selected: pain }}
            >
              <Ionicons
                name="medical-outline"
                size={16}
                color={pain ? Colors.danger : Colors.textSecondary}
              />
              <Text style={[styles.checkInPainText, pain && styles.checkInPainTextSelected]}>
                {pain ? 'Pain noted' : 'Something hurt'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.checkInLabel}>Notes *</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Felt strong, form stayed clean, shoulder was tired, machine substitution…"
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
      {activeCelebration && (
        <PrCelebration
          record={activeCelebration}
          onDone={dismissCelebration}
        />
      )}
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
  planError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  planErrorBody: {
    flex: 1,
    gap: 2,
  },
  planErrorTitle: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '800',
  },
  planErrorText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  planRetryButton: {
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  planRetryText: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontWeight: '800',
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
  planCardSuggested: {
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.primary,
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
  setRowBlock: {
    paddingBottom: Spacing.xs,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs + 2,
    gap: Spacing.sm,
  },
  prSetBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginLeft: 56,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    backgroundColor: Colors.warningDim,
    borderRadius: Radius.full,
  },
  prSetBadgeText: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontWeight: '800',
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

  // Workout check-in
  checkInHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 19,
    marginBottom: Spacing.md,
  },
  checkInLabel: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  checkInEffortRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  checkInEffortButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    paddingHorizontal: Spacing.xs,
  },
  checkInEffortButtonSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryDim,
  },
  checkInEffortText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  checkInEffortTextSelected: { color: Colors.primary },
  checkInPainButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  checkInPainButtonSelected: { opacity: 1 },
  checkInPainText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  checkInPainTextSelected: { color: Colors.danger },
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
  successPrCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    marginVertical: Spacing.md,
    gap: Spacing.md,
  },
  successPrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successPrTitle: {
    color: Colors.warning,
    fontSize: FontSize.base,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  successPrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successPrCopy: { flex: 1 },
  successPrExercise: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  successPrValue: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    marginTop: 2,
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

  // PR celebration overlay
  prOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    zIndex: 50,
  },
  prCelebration: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    overflow: 'visible',
    backgroundColor: '#201B05',
    borderColor: Colors.warning,
    borderWidth: 2,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
    shadowColor: Colors.warning,
    shadowOpacity: 0.65,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  prTrophyRing: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: Colors.warningDim,
    borderColor: Colors.warning,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  prCelebrationEyebrow: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  prCelebrationTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  prCelebrationValue: {
    color: Colors.warning,
    fontSize: FontSize.base,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  prSpark: {
    position: 'absolute',
    color: Colors.warning,
    fontSize: 26,
    fontWeight: '900',
  },
  prSparkTopLeft: { top: 18, left: 24, transform: [{ rotate: '-15deg' }] },
  prSparkTopRight: { top: 28, right: 30, transform: [{ rotate: '18deg' }] },
  prSparkBottomLeft: { bottom: 28, left: 34, transform: [{ rotate: '12deg' }] },
  prSparkBottomRight: { bottom: 20, right: 24, transform: [{ rotate: '-12deg' }] },

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
