import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TrendLineChart, LineTrendPoint } from '../components/TrendLineChart';
import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import { useHealth } from '../context/HealthContext';
import { useWorkouts } from '../context/WorkoutsContext';
import { localDateKey, previousLocalDateKey } from '../utils/date';
import { formatVolume } from '../utils/stats';
import {
  aggregateNutritionTrend,
  aggregateRecoveryTrend,
  aggregateTrainingTrend,
  aggregateWeightTrend,
  buildTrendSeries,
  calculateRecoveryComparison,
  includeRecoveryActivityDetails,
  RecoveryTrendPoint,
  TrendRange,
} from '../utils/trends';

type TrendCategory = 'weight' | 'nutrition' | 'training' | 'recovery';
type MetricKey =
  | 'weight'
  | 'bodyFat'
  | 'leanMass'
  | 'calories'
  | 'protein'
  | 'fiber'
  | 'volume'
  | 'sessions'
  | 'minutes'
  | 'sleep'
  | 'awake'
  | 'sleepEfficiency'
  | 'restingHeartRate'
  | 'hrv'
  | 'steps'
  | 'activeCalories'
  | 'exerciseMinutes';

interface MetricOption {
  key: MetricKey;
  label: string;
  color: string;
}

const CATEGORIES: {
  key: TrendCategory;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'weight', label: 'Weight', icon: 'scale-outline' },
  { key: 'nutrition', label: 'Nutrition', icon: 'restaurant-outline' },
  { key: 'training', label: 'Training', icon: 'barbell-outline' },
  { key: 'recovery', label: 'Recovery', icon: 'heart-outline' },
];

const METRICS: Record<TrendCategory, MetricOption[]> = {
  weight: [
    { key: 'weight', label: 'Weight', color: Colors.primary },
    { key: 'bodyFat', label: 'Body Fat', color: Colors.warning },
    { key: 'leanMass', label: 'Lean Mass', color: Colors.success },
  ],
  nutrition: [
    { key: 'calories', label: 'Calories', color: Colors.warning },
    { key: 'protein', label: 'Protein', color: Colors.primary },
    { key: 'fiber', label: 'Fiber', color: Colors.success },
  ],
  training: [
    { key: 'volume', label: 'Volume', color: Colors.primary },
    { key: 'sessions', label: 'Sessions', color: Colors.success },
    { key: 'minutes', label: 'Minutes', color: Colors.warning },
  ],
  recovery: [
    { key: 'sleep', label: 'Sleep', color: Colors.primary },
    { key: 'awake', label: 'Awake', color: Colors.warning },
    { key: 'sleepEfficiency', label: 'Efficiency', color: Colors.success },
    { key: 'restingHeartRate', label: 'Resting HR', color: Colors.warning },
    { key: 'hrv', label: 'HRV', color: Colors.primary },
    { key: 'steps', label: 'Steps', color: Colors.success },
    { key: 'activeCalories', label: 'Active kcal', color: Colors.warning },
    { key: 'exerciseMinutes', label: 'Exercise', color: Colors.primary },
  ],
};

const RANGES: TrendRange[] = ['7D', '30D', '90D', 'ALL'];

function categoryFromParam(value: string | string[] | undefined): TrendCategory {
  const key = Array.isArray(value) ? value[0] : value;
  if (key === 'nutrition' || key === 'training' || key === 'recovery') return key;
  return 'weight';
}

function defaultMetric(category: TrendCategory): MetricKey {
  return METRICS[category][0].key;
}

function formatMinutes(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const minutes = Math.abs(rounded);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${sign}${hours}h ${remainder}m`;
  if (hours) return `${sign}${hours}h`;
  return `${sign}${remainder} min`;
}

function formatMetricValue(metric: MetricKey, value: number): string {
  if (metric === 'weight' || metric === 'leanMass') return `${value.toFixed(1)} lb`;
  if (metric === 'bodyFat' || metric === 'sleepEfficiency') return `${value.toFixed(1)}%`;
  if (metric === 'calories' || metric === 'activeCalories') return `${Math.round(value).toLocaleString()} kcal`;
  if (metric === 'protein' || metric === 'fiber') return `${value.toFixed(1)} g`;
  if (metric === 'volume') return formatVolume(Math.round(value));
  if (metric === 'minutes' || metric === 'sleep' || metric === 'awake' || metric === 'exerciseMinutes') return formatMinutes(value);
  if (metric === 'restingHeartRate') return `${value.toFixed(0)} bpm`;
  if (metric === 'hrv') return `${value.toFixed(1)} ms`;
  if (metric === 'steps') return Math.round(value).toLocaleString();
  return value.toFixed(1);
}

function recoveryMetricValue(point: RecoveryTrendPoint, metric: MetricKey): number | undefined {
  if (metric === 'sleep') return point.sleepMinutes;
  if (metric === 'awake') return point.awakeMinutes;
  if (metric === 'sleepEfficiency') return point.sleepEfficiencyPercent;
  if (metric === 'restingHeartRate') return point.restingHeartRateBpm;
  if (metric === 'hrv') return point.hrvMs;
  if (metric === 'steps') return point.steps;
  if (metric === 'activeCalories') return point.activeCalories;
  if (metric === 'exerciseMinutes') return point.exerciseMinutes;
  return undefined;
}

function recoveryMetricUsesCompletedDays(metric: MetricKey): boolean {
  return metric === 'steps' || metric === 'activeCalories' || metric === 'exerciseMinutes';
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryCardValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.summaryCardLabel}>{label}</Text>
    </View>
  );
}

export default function TrendsScreen() {
  const params = useLocalSearchParams<{ metric?: string }>();
  const initialCategory = categoryFromParam(params.metric);
  const [category, setCategory] = useState<TrendCategory>(initialCategory);
  const [metric, setMetric] = useState<MetricKey>(defaultMetric(initialCategory));
  const [range, setRange] = useState<TrendRange>('30D');
  const { bodyWeightEntries, nutritionEntries, healthDailyEntries, goals } = useHealth();
  const { sessions } = useWorkouts();
  const today = localDateKey();
  const recoveryAsOfDate = recoveryMetricUsesCompletedDays(metric)
    ? previousLocalDateKey()
    : today;

  const availableMetrics = useMemo(() => {
    if (category !== 'weight') return METRICS[category];
    const hasBodyFat = bodyWeightEntries.some(entry => entry.bodyFatPercent != null);
    const hasLeanMass = bodyWeightEntries.some(entry => entry.leanBodyMassLbs != null);
    return METRICS.weight.filter(option =>
      option.key === 'weight' ||
      (option.key === 'bodyFat' && hasBodyFat) ||
      (option.key === 'leanMass' && hasLeanMass),
    );
  }, [bodyWeightEntries, category]);

  const rawPoints = useMemo<LineTrendPoint[]>(() => {
    if (category === 'weight') {
      return aggregateWeightTrend(bodyWeightEntries)
        .map(point => {
          const details = [
            metric === 'weight' ? null : { label: 'Weight', value: `${point.value.toFixed(1)} lb` },
            metric === 'bodyFat' || point.bodyFatPercent == null
              ? null
              : { label: 'Body Fat', value: `${point.bodyFatPercent.toFixed(1)}%` },
            metric === 'leanMass' || point.leanBodyMassLbs == null
              ? null
              : { label: 'Lean Mass', value: `${point.leanBodyMassLbs.toFixed(1)} lb` },
            point.bmi == null ? null : { label: 'BMI', value: point.bmi.toFixed(1) },
            point.source == null
              ? null
              : { label: 'Source', value: point.source === 'apple-health' ? 'Apple Health' : point.source === 'health-connect' ? 'Health Connect' : point.source },
          ].filter((detail): detail is { label: string; value: string } => detail !== null);

          if (metric === 'bodyFat' && point.bodyFatPercent != null) {
            return { date: point.date, value: point.bodyFatPercent, details };
          }
          if (metric === 'leanMass' && point.leanBodyMassLbs != null) {
            return { date: point.date, value: point.leanBodyMassLbs, details };
          }
          if (metric === 'weight') return { date: point.date, value: point.value, details };
          return null;
        })
        .filter((point): point is { date: string; value: number; details: { label: string; value: string }[] } => point !== null);
    }

    if (category === 'recovery') {
      return aggregateRecoveryTrend(healthDailyEntries)
        .filter(point => point.date <= recoveryAsOfDate)
        .map(point => {
          const value = recoveryMetricValue(point, metric);
          if (value == null) return null;
          const includeActivity = includeRecoveryActivityDetails(point.date, today);
          const details = [
            point.sleepMinutes == null ? null : { label: 'Sleep', value: formatMinutes(point.sleepMinutes) },
            point.awakeMinutes == null ? null : { label: 'Awake', value: formatMinutes(point.awakeMinutes) },
            point.sleepEfficiencyPercent == null ? null : { label: 'Sleep Efficiency', value: `${point.sleepEfficiencyPercent.toFixed(1)}%` },
            point.restingHeartRateBpm == null ? null : { label: 'Resting HR', value: `${point.restingHeartRateBpm.toFixed(0)} bpm` },
            point.hrvMs == null ? null : { label: 'HRV', value: `${point.hrvMs.toFixed(1)} ms` },
            ...(includeActivity ? [
              point.steps == null ? null : { label: 'Steps', value: point.steps.toLocaleString() },
              point.activeCalories == null ? null : { label: 'Active Energy', value: `${Math.round(point.activeCalories)} kcal` },
              point.exerciseMinutes == null ? null : { label: 'Exercise', value: formatMinutes(point.exerciseMinutes) },
            ] : []),
            {
              label: 'Source',
              value: point.source === 'google-health'
                ? 'Google Health'
                : point.source === 'health-connect'
                  ? 'Health Connect'
                  : 'Apple Health',
            },
          ].filter((detail): detail is { label: string; value: string } => detail !== null);
          return { date: point.date, value, details };
        })
        .filter((point): point is { date: string; value: number; details: { label: string; value: string }[] } => point !== null);
    }

    if (category === 'nutrition') {
      return aggregateNutritionTrend(nutritionEntries, today).map(point => ({
        date: point.date,
        value:
          metric === 'protein'
            ? point.proteinG
            : metric === 'fiber'
              ? point.fiberG
              : point.calories,
        details: [
          { label: 'Calories', value: `${Math.round(point.calories).toLocaleString()} kcal` },
          { label: 'Protein', value: `${point.proteinG.toFixed(1)} g` },
          { label: 'Carbs', value: `${point.carbsG.toFixed(1)} g` },
          { label: 'Fat', value: `${point.fatG.toFixed(1)} g` },
          { label: 'Fiber', value: `${point.fiberG.toFixed(1)} g` },
        ],
      }));
    }

    return aggregateTrainingTrend(sessions).map(point => ({
      date: point.date,
      value:
        metric === 'sessions'
          ? point.sessions
          : metric === 'minutes'
            ? point.minutes
            : point.volume,
      details: [
        { label: 'Strength Volume', value: formatVolume(Math.round(point.volume)) },
        { label: 'Sessions', value: point.sessions.toFixed(0) },
        { label: 'Minutes', value: `${Math.round(point.minutes)} min` },
      ],
    }));
  }, [bodyWeightEntries, category, healthDailyEntries, metric, nutritionEntries, recoveryAsOfDate, sessions, today]);

  const visiblePoints = useMemo(() => {
    const usesAverage =
      (category === 'weight' && metric === 'weight') ||
      category === 'nutrition' ||
      category === 'recovery';
    const asOfDate = category === 'recovery' ? recoveryAsOfDate : today;
    return buildTrendSeries(rawPoints, range, asOfDate, usesAverage ? 7 : undefined);
  }, [category, metric, range, rawPoints, recoveryAsOfDate, today]);

  const recoveryComparison = useMemo(
    () => calculateRecoveryComparison(rawPoints, recoveryAsOfDate),
    [rawPoints, recoveryAsOfDate],
  );

  const activeOption = availableMetrics.find(option => option.key === metric)
    ?? METRICS[category][0];
  const goalKind = metric === 'weight'
    ? 'weight'
    : metric === 'calories'
      ? 'calories'
      : metric === 'protein'
        ? 'protein'
        : metric === 'fiber'
          ? 'fiber'
          : metric === 'sessions'
            ? 'workout_frequency'
            : null;
  const goal = goalKind
    ? goals.find(item => item.status === 'active' && item.kind === goalKind)?.targetValue
    : undefined;

  const values = visiblePoints.map(point => point.value);
  const latest = values.at(-1);
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
  const change = values.length > 1 ? values.at(-1)! - values[0] : undefined;
  const isTraining = category === 'training';
  const total = values.reduce((sum, value) => sum + value, 0);

  const handleCategory = (next: TrendCategory) => {
    setCategory(next);
    setMetric(defaultMetric(next));
    setRange(next === 'training' ? '90D' : '30D');
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.categoryRow}>
          {CATEGORIES.map(item => {
            const selected = item.key === category;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.categoryButton, selected && styles.categoryButtonSelected]}
                onPress={() => handleCategory(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={selected ? Colors.primary : Colors.textMuted}
                />
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.metricRow}>
          {availableMetrics.map(option => {
            const selected = option.key === metric;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.metricButton, selected && { borderColor: option.color, backgroundColor: `${option.color}18` }]}
                onPress={() => setMetric(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.metricText, selected && { color: option.color }]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.rangeRow}>
          {RANGES.map(option => {
            const selected = option === range;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.rangeButton, selected && styles.rangeButtonSelected]}
                onPress={() => setRange(option)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.rangeText, selected && styles.rangeTextSelected]}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.summaryRow}>
          {category === 'recovery' ? (
            <>
              <SummaryCard
                label={`7D Avg · ${recoveryComparison.currentObservedDays}/7`}
                value={recoveryComparison.currentAverage == null ? '—' : formatMetricValue(metric, recoveryComparison.currentAverage)}
              />
              <SummaryCard
                label={`28D Base · ${recoveryComparison.baselineObservedDays}/28`}
                value={recoveryComparison.baselineAverage == null ? 'Building' : formatMetricValue(metric, recoveryComparison.baselineAverage)}
              />
              <SummaryCard
                label="vs Baseline"
                value={recoveryComparison.delta == null
                  ? '—'
                  : `${recoveryComparison.delta > 0 ? '+' : ''}${formatMetricValue(metric, recoveryComparison.delta)}`}
              />
            </>
          ) : (
            <>
              <SummaryCard
                label={isTraining ? 'Total' : 'Latest'}
                value={isTraining ? formatMetricValue(metric, total) : latest == null ? '—' : formatMetricValue(metric, latest)}
              />
              <SummaryCard
                label={isTraining ? 'Per Week' : 'Average'}
                value={average == null ? '—' : formatMetricValue(metric, average)}
              />
              <SummaryCard
                label="Change"
                value={change == null ? '—' : `${change > 0 ? '+' : ''}${formatMetricValue(metric, change)}`}
              />
            </>
          )}
        </View>

        <TrendLineChart
          points={visiblePoints}
          color={activeOption.color}
          valueFormatter={value => formatMetricValue(metric, value)}
          goal={goal}
          showAverage={visiblePoints.length > 1 && (
            (category === 'weight' && metric === 'weight') ||
            category === 'nutrition' ||
            category === 'recovery'
          )}
          floorAtZero={category === 'nutrition' || category === 'training'}
          pixelsPerDay={category === 'training' ? 7 : 44}
        />

        <View style={styles.contextCard}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.contextText}>
            {category === 'weight'
              ? metric === 'weight'
                ? 'The bright line is your seven-calendar-day average; daily readings remain visible underneath.'
                : 'Smart-scale composition is noisy day to day. Judge the direction across several weeks.'
              : category === 'nutrition'
                ? `${visiblePoints.length} completed logged day${visiblePoints.length === 1 ? '' : 's'} shown. Today and unlogged days are omitted rather than treated as complete zero-calorie days.`
                : category === 'recovery'
                  ? recoveryComparison.baselineAverage == null
                    ? `The bright line is the seven-day average across observed days. Personal baseline is still building (${recoveryComparison.baselineObservedDays}/28 observed days; at least 7 are required). Missing metrics remain gaps, never zeroes.${recoveryMetricUsesCompletedDays(metric) ? ' Today is omitted because this activity total is still in progress.' : ''}`
                    : `The bright line is the seven-day average across observed days. The summary compares it with the preceding 28-day personal baseline (${recoveryComparison.baselineObservedDays}/28 observed); direction is context, not a readiness score.${recoveryMetricUsesCompletedDays(metric) ? ' Today is omitted because this activity total is still in progress.' : ''}`
                  : 'Training is grouped into Monday–Sunday weeks. Volume includes strength sets only; cardio does not inflate it.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.base, paddingBottom: Spacing.xxxl, gap: Spacing.base },
  categoryRow: { flexDirection: 'row', gap: Spacing.sm },
  categoryButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  categoryButtonSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  categoryText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700' },
  categoryTextSelected: { color: Colors.primary },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metricButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  metricText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  rangeRow: {
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rangeButton: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  rangeButtonSelected: { backgroundColor: Colors.card },
  rangeText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700' },
  rangeTextSelected: { color: Colors.text },
  summaryRow: { flexDirection: 'row', gap: Spacing.sm },
  summaryCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  summaryCardValue: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  summaryCardLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginTop: 3,
    textTransform: 'uppercase',
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  contextText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 19 },
});
