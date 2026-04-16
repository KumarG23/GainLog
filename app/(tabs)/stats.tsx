import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../../constants/theme';
import { useWorkouts } from '../../context/WorkoutsContext';
import { computeExerciseStats, ExerciseStats, formatVolume } from '../../utils/stats';

// ---------------------------------------------------------------------------
// Top summary bar
// ---------------------------------------------------------------------------

interface SummaryPillProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
}

function SummaryPill({ icon, iconColor, iconBg, label, value }: SummaryPillProps) {
  return (
    <View style={styles.summaryPill}>
      <View style={[styles.summaryIconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Exercise stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  stat: ExerciseStats;
  rank: number;
}

function StatCard({ stat, rank }: StatCardProps) {
  const bestWeight =
    stat.bestSet.weight > 0
      ? `${stat.bestSet.weight} lbs × ${stat.bestSet.reps}`
      : `${stat.bestSet.reps} reps (BW)`;

  return (
    <View style={styles.statCard}>
      {/* Header */}
      <View style={styles.statCardHeader}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
        <Text style={styles.exerciseName} numberOfLines={1}>
          {stat.name}
        </Text>
        <View style={styles.sessionsBadge}>
          <Text style={styles.sessionsBadgeText}>
            {stat.sessionCount}×
          </Text>
        </View>
      </View>

      {/* Metrics grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCell}>
          <View style={[styles.metricIconWrap, { backgroundColor: Colors.primaryDim }]}>
            <Ionicons name="trophy-outline" size={14} color={Colors.primary} />
          </View>
          <Text style={styles.metricValue}>{bestWeight}</Text>
          <Text style={styles.metricLabel}>Best Set</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCell}>
          <View style={[styles.metricIconWrap, { backgroundColor: Colors.successDim }]}>
            <Ionicons name="trending-up-outline" size={14} color={Colors.success} />
          </View>
          <Text style={styles.metricValue}>{formatVolume(stat.totalVolume)}</Text>
          <Text style={styles.metricLabel}>Total Volume</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCell}>
          <View style={[styles.metricIconWrap, { backgroundColor: Colors.warningDim }]}>
            <Ionicons name="layers-outline" size={14} color={Colors.warning} />
          </View>
          <Text style={styles.metricValue}>{stat.totalSets}</Text>
          <Text style={styles.metricLabel}>Total Sets</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyStats() {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="bar-chart-outline" size={56} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>No stats yet</Text>
      <Text style={styles.emptySubtitle}>
        Log your first workout to see per-exercise stats here.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StatsScreen() {
  const { sessions, loading } = useWorkouts();

  const stats = useMemo(() => computeExerciseStats(sessions), [sessions]);

  const totalVolume = useMemo(
    () => sessions.reduce((acc, s) =>
      acc + s.exercises.reduce((a, e) =>
        a + e.sets.reduce((v, set) => v + set.weight * set.reps, 0), 0), 0),
    [sessions],
  );

  const totalDuration = useMemo(
    () => sessions.reduce((acc, s) => acc + s.durationMinutes, 0),
    [sessions],
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

  if (sessions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EmptyStats />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={stats}
        keyExtractor={item => item.name}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Summary pills */}
            <View style={styles.summaryRow}>
              <SummaryPill
                icon="fitness-outline"
                iconColor={Colors.primary}
                iconBg={Colors.primaryDim}
                label="Sessions"
                value={String(sessions.length)}
              />
              <SummaryPill
                icon="time-outline"
                iconColor={Colors.success}
                iconBg={Colors.successDim}
                label="Hours"
                value={(totalDuration / 60).toFixed(1)}
              />
              <SummaryPill
                icon="barbell-outline"
                iconColor={Colors.warning}
                iconBg={Colors.warningDim}
                label="Volume"
                value={formatVolume(totalVolume)}
              />
            </View>

            <Text style={styles.sectionHeading}>
              {stats.length} exercise{stats.length !== 1 ? 's' : ''} tracked
            </Text>
          </>
        }
        renderItem={({ item, index }) => (
          <StatCard stat={item} rank={index + 1} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        ListFooterComponent={<View style={{ height: Spacing.xxxl }} />}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },

  // Summary row
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  summaryPill: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.text,
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  sectionHeading: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
  },

  // Stat card
  statCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
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
  sessionsBadge: {
    backgroundColor: Colors.card,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  sessionsBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
  },

  // Metrics
  metricsGrid: {
    flexDirection: 'row',
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  metricCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: 'stretch',
  },
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
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
