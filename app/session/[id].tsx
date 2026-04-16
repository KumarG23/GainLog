import React, { useCallback } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useWorkouts } from '../../context/WorkoutsContext';
import { Exercise, WorkoutSet } from '../../types/workout';
import { formatDate } from '../../utils/date';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exerciseVolume(ex: Exercise): number {
  return ex.sets.reduce((acc, s) => acc + s.weight * s.reps, 0);
}

function bestSet(sets: WorkoutSet[]): WorkoutSet | null {
  if (sets.length === 0) return null;
  return sets.reduce((best, s) => {
    const bv = best.weight * best.reps;
    const sv = s.weight * s.reps;
    return sv > bv ? s : best;
  }, sets[0]);
}

// ---------------------------------------------------------------------------
// Exercise table
// ---------------------------------------------------------------------------

interface ExerciseTableProps {
  exercise: Exercise;
  index: number;
}

function ExerciseTable({ exercise, index }: ExerciseTableProps) {
  const best = bestSet(exercise.sets);
  const volume = exerciseVolume(exercise);

  return (
    <View style={styles.exerciseCard}>
      {/* Header */}
      <View style={styles.exerciseHeader}>
        <View style={styles.exerciseIndexBadge}>
          <Text style={styles.exerciseIndexText}>{index + 1}</Text>
        </View>
        <Text style={styles.exerciseName}>{exercise.name}</Text>
      </View>

      {/* Sets table */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCell, styles.colSet]}>SET</Text>
        <Text style={[styles.tableCell, styles.colWeight]}>LBS</Text>
        <Text style={[styles.tableCell, styles.colReps]}>REPS</Text>
        <Text style={[styles.tableCell, styles.colVol]}>VOL</Text>
      </View>

      {exercise.sets.map((set, idx) => {
        const isBest =
          best !== null &&
          set.weight === best.weight &&
          set.reps === best.reps &&
          set.id === best.id;
        return (
          <View
            key={set.id}
            style={[styles.tableRow, isBest && styles.tableRowBest]}
          >
            <View style={[styles.colSet, styles.setNumWrap]}>
              <View style={styles.setNumBubble}>
                <Text style={styles.setNum}>{idx + 1}</Text>
              </View>
            </View>
            <Text style={[styles.tableCell, styles.colWeight, styles.cellValue]}>
              {set.weight > 0 ? set.weight : '—'}
            </Text>
            <Text style={[styles.tableCell, styles.colReps, styles.cellValue]}>
              {set.reps}
            </Text>
            <Text style={[styles.tableCell, styles.colVol, styles.cellValue]}>
              {set.weight > 0 ? `${set.weight * set.reps}` : set.reps}
            </Text>
            {isBest && (
              <View style={styles.bestBadge}>
                <Ionicons name="trophy" size={10} color={Colors.warning} />
              </View>
            )}
          </View>
        );
      })}

      {/* Exercise footer */}
      <View style={styles.exerciseFooter}>
        <Text style={styles.exerciseFooterText}>
          {exercise.sets.length} sets ·{' '}
          {exercise.sets.reduce((a, s) => a + s.reps, 0)} reps
          {volume > 0 ? ` · ${volume.toLocaleString()} lbs total` : ''}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getSession, deleteSession } = useWorkouts();

  const session = getSession(id);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Session',
      'This session will be permanently deleted. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSession(id);
            router.back();
          },
        },
      ],
    );
  }, [id, deleteSession, router]);

  if (!session) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Session' }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.notFoundText}>Session not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalVolume = session.exercises.reduce(
    (acc, ex) => acc + exerciseVolume(ex),
    0,
  );
  const totalSets = session.exercises.reduce(
    (acc, ex) => acc + ex.sets.length,
    0,
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: formatDate(session.date),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={20} color={Colors.danger} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero metrics */}
        <View style={styles.heroRow}>
          <View style={styles.heroMetric}>
            <Ionicons name="time-outline" size={20} color={Colors.primary} />
            <Text style={styles.heroValue}>{session.durationMinutes}</Text>
            <Text style={styles.heroLabel}>min</Text>
          </View>

          {session.avgHeartRate != null && (
            <>
              <View style={styles.heroDivider} />
              <View style={styles.heroMetric}>
                <Ionicons name="heart" size={20} color={Colors.danger} />
                <Text style={styles.heroValue}>{session.avgHeartRate}</Text>
                <Text style={styles.heroLabel}>avg bpm</Text>
              </View>
            </>
          )}

          {session.activeCalories != null && (
            <>
              <View style={styles.heroDivider} />
              <View style={styles.heroMetric}>
                <Ionicons name="flame" size={20} color={Colors.warning} />
                <Text style={styles.heroValue}>{session.activeCalories}</Text>
                <Text style={styles.heroLabel}>kcal</Text>
              </View>
            </>
          )}

          <View style={styles.heroDivider} />
          <View style={styles.heroMetric}>
            <Ionicons name="barbell-outline" size={20} color={Colors.success} />
            <Text style={styles.heroValue}>{totalSets}</Text>
            <Text style={styles.heroLabel}>sets</Text>
          </View>
        </View>

        {/* Volume chip */}
        {totalVolume > 0 && (
          <View style={styles.volumeChip}>
            <Ionicons name="trending-up" size={14} color={Colors.primary} />
            <Text style={styles.volumeChipText}>
              {totalVolume.toLocaleString()} lbs total volume
            </Text>
          </View>
        )}

        {/* Notes */}
        {session.notes != null && session.notes.length > 0 && (
          <View style={styles.notesCard}>
            <View style={styles.notesHeader}>
              <Ionicons
                name="document-text-outline"
                size={15}
                color={Colors.textMuted}
              />
              <Text style={styles.notesTitle}>Notes</Text>
            </View>
            <Text style={styles.notesBody}>{session.notes}</Text>
          </View>
        )}

        {/* Section heading */}
        <Text style={styles.sectionHeading}>
          {session.exercises.length} Exercise
          {session.exercises.length !== 1 ? 's' : ''}
        </Text>

        {/* Exercise tables */}
        {session.exercises.map((exercise, idx) => (
          <ExerciseTable key={exercise.id} exercise={exercise} index={idx} />
        ))}

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },

  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  notFoundText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },

  // Hero row
  heroRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.base,
    marginBottom: Spacing.sm,
    justifyContent: 'space-around',
  },
  heroMetric: {
    alignItems: 'center',
    gap: 4,
  },
  heroValue: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.text,
  },
  heroLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },

  // Volume chip
  volumeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  volumeChipText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Notes
  notesCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  notesTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  notesBody: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
  },

  sectionHeading: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
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
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  exerciseIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseIndexText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
  },
  exerciseName: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },

  // Table
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.card,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    position: 'relative',
  },
  tableRowBest: {
    backgroundColor: 'rgba(255, 214, 10, 0.05)',
  },
  tableCell: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  cellValue: {
    fontSize: FontSize.base,
    color: Colors.text,
    fontWeight: '600',
    textTransform: 'none',
    letterSpacing: 0,
  },

  // Column widths
  colSet: { width: 36 },
  colWeight: { flex: 1 },
  colReps: { flex: 1 },
  colVol: { flex: 1 },

  setNumWrap: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNumBubble: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNum: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  bestBadge: {
    position: 'absolute',
    right: Spacing.base,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  // Exercise footer
  exerciseFooter: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  exerciseFooterText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    fontWeight: '500',
  },
});
