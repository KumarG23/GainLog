import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import type { WorkoutEffort, WorkoutSession } from '../types/workout';

interface CoachInsightCardProps {
  session: WorkoutSession;
  loading?: boolean;
  error?: string | null;
  onFeedback?: (
    feedback: { effort?: WorkoutEffort; pain?: boolean },
  ) => Promise<void>;
}

const effortOptions: { label: string; value: WorkoutEffort }[] = [
  { label: 'Easy', value: 'easy' },
  { label: 'About right', value: 'right' },
  { label: 'Hard', value: 'hard' },
];

export function CoachInsightCard({
  session,
  loading = false,
  error = null,
  onFeedback,
}: CoachInsightCardProps) {
  const [savingFeedback, setSavingFeedback] = useState(false);
  const insight = session.coachInsight;
  const distance = session.exercises
    .filter(exercise => exercise.kind === 'cardio')
    .reduce((sum, exercise) => sum + (exercise.distanceMiles ?? 0), 0);

  const saveFeedback = async (feedback: { effort?: WorkoutEffort; pain?: boolean }) => {
    if (!onFeedback || savingFeedback) return;
    setSavingFeedback(true);
    try {
      await onFeedback(feedback);
    } catch {
      Alert.alert('Feedback not saved', 'Check your connection and try again.');
    } finally {
      setSavingFeedback(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.labelRow}>
        <Ionicons name="sparkles" size={14} color={Colors.primary} />
        <Text style={styles.label}>AI Coach</Text>
      </View>

      <View style={styles.metricsRow}>
        <Metric value={`${session.durationMinutes}`} label="MIN" />
        {distance > 0 && <Metric value={distance.toFixed(2)} label="MI" />}
        {session.avgHeartRate != null && (
          <Metric value={`${session.avgHeartRate}`} label="AVG HR" />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.muted}>Finding the useful signal…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={17} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : insight ? (
        <>
          <Text style={styles.headline}>{insight.headline}</Text>
          <Text style={styles.verdict}>{insight.verdict}</Text>

          {insight.wins.map(win => (
            <View style={styles.winRow} key={win}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.winText}>{win}</Text>
            </View>
          ))}

          {insight.caveat && (
            <View style={styles.caveatRow}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
              <Text style={styles.caveatText}>{insight.caveat}</Text>
            </View>
          )}

          <View style={styles.nextAction}>
            <Text style={styles.nextActionTitle}>{insight.nextAction.title}</Text>
            <Text style={styles.nextActionText}>{insight.nextAction.detail}</Text>
          </View>

          {onFeedback && (
            <View style={styles.feedbackSection}>
              <Text style={styles.question}>{insight.question}</Text>
              <View style={styles.feedbackRow}>
                {effortOptions.map(option => {
                  const selected = session.effort === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.feedbackChip, selected && styles.feedbackChipSelected]}
                      disabled={savingFeedback}
                      onPress={() => saveFeedback({ effort: option.value })}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.feedbackChipText, selected && styles.feedbackChipTextSelected]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.painButton, session.pain && styles.painButtonSelected]}
                disabled={savingFeedback}
                onPress={() => saveFeedback({ pain: !session.pain })}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(session.pain) }}
              >
                <Ionicons
                  name="medical-outline"
                  size={15}
                  color={session.pain ? Colors.danger : Colors.textSecondary}
                />
                <Text style={[styles.painText, session.pain && styles.painTextSelected]}>
                  {session.pain ? 'Pain noted' : 'Something hurt'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : session.insight ? (
        <>
          <Text style={styles.headline}>Workout complete</Text>
          <Text style={styles.verdict}>{session.insight}</Text>
        </>
      ) : null}
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  label: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricValue: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  metricLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  headline: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  verdict: { color: Colors.textSecondary, fontSize: FontSize.base, lineHeight: 22 },
  winRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  winText: { flex: 1, color: Colors.text, fontSize: FontSize.sm, lineHeight: 20 },
  caveatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  caveatText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 19 },
  nextAction: {
    backgroundColor: Colors.primaryDim,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  nextActionTitle: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '800', textTransform: 'uppercase' },
  nextActionText: { color: Colors.text, fontSize: FontSize.base, lineHeight: 21, fontWeight: '600' },
  feedbackSection: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md, gap: Spacing.sm },
  question: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '700' },
  feedbackRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  feedbackChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  feedbackChipSelected: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  feedbackChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  feedbackChipTextSelected: { color: Colors.primary },
  painButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: Spacing.xs, paddingVertical: Spacing.xs },
  painButtonSelected: { opacity: 1 },
  painText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  painTextSelected: { color: Colors.danger },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  muted: { color: Colors.textMuted, fontSize: FontSize.sm },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  errorText: { flex: 1, color: Colors.danger, fontSize: FontSize.sm, lineHeight: 20 },
});
