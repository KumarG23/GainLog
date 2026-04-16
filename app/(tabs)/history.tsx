import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useWorkouts } from '../../context/WorkoutsContext';
import { WorkoutSession } from '../../types/workout';
import { formatRelativeDate, formatShortDate } from '../../utils/date';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionTotalVolume(session: WorkoutSession): number {
  return session.exercises.reduce(
    (acc, ex) =>
      acc + ex.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );
}

function sessionLabel(session: WorkoutSession): string {
  const names = session.exercises.map(e => e.name).filter(Boolean);
  if (names.length === 0) return 'Workout';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1} more`;
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: WorkoutSession;
  onPress: () => void;
}

function SessionCard({ session, onPress }: SessionCardProps) {
  const volume = sessionTotalVolume(session);
  const totalSets = session.exercises.reduce(
    (acc, ex) => acc + ex.sets.length,
    0,
  );

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Top row: relative date + chevron */}
      <View style={styles.cardTop}>
        <View style={styles.datePill}>
          <Text style={styles.datePillText}>
            {formatRelativeDate(session.date)}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={Colors.textMuted}
        />
      </View>

      {/* Exercise label */}
      <Text style={styles.cardTitle} numberOfLines={1}>
        {sessionLabel(session)}
      </Text>
      <Text style={styles.cardDate}>{formatShortDate(session.date)}</Text>

      {/* Stats row */}
      <View style={styles.cardStats}>
        <View style={styles.statItem}>
          <Ionicons name="barbell-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.statText}>
            {session.exercises.length} exercise
            {session.exercises.length !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.statDot} />

        <View style={styles.statItem}>
          <Ionicons name="layers-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.statText}>
            {totalSets} set{totalSets !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.statDot} />

        <View style={styles.statItem}>
          <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.statText}>{session.durationMinutes} min</Text>
        </View>

        {session.activeCalories != null && (
          <>
            <View style={styles.statDot} />
            <View style={styles.statItem}>
              <Ionicons name="flame-outline" size={14} color={Colors.warning} />
              <Text style={styles.statText}>{session.activeCalories} kcal</Text>
            </View>
          </>
        )}
      </View>

      {/* Volume bar */}
      {volume > 0 && (
        <View style={styles.volumeRow}>
          <Text style={styles.volumeLabel}>Total Volume</Text>
          <Text style={styles.volumeValue}>
            {volume >= 10000
              ? `${(volume / 1000).toFixed(1)}k`
              : `${volume.toLocaleString()} lbs`}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyHistory() {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="time-outline" size={56} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>No sessions yet</Text>
      <Text style={styles.emptySubtitle}>
        Complete your first workout on the Log tab.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function HistoryScreen() {
  const router = useRouter();
  const { sessions, loading, refresh } = useWorkouts();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handlePress = useCallback(
    (id: string) => {
      router.push(`/session/${id}`);
    },
    [router],
  );

  if (loading) {
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
      <FlatList
        data={sessions}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          sessions.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={<EmptyHistory />}
        ListHeaderComponent={
          sessions.length > 0 ? (
            <Text style={styles.listHeader}>
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <SessionCard session={item} onPress={() => handlePress(item.id)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  listContentEmpty: { flex: 1 },

  listHeader: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
  },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  datePill: {
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  datePillText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  cardDate: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },

  // Stats
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  statDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
  },

  // Volume
  volumeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    marginTop: Spacing.xs,
  },
  volumeLabel: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  volumeValue: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Empty
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
  emptySubtitle: {
    fontSize: FontSize.base,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
});
