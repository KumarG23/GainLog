import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import {
  relativeDatePositions,
  resolveChartDomain,
  resolveChartWidth,
  resolveScrollableChartWidth,
} from '../utils/trends';

export interface TrendPointDetail {
  label: string;
  value: string;
}

export interface LineTrendPoint {
  date: string;
  value: number;
  average?: number;
  details?: TrendPointDetail[];
}

interface TrendLineChartProps {
  points: LineTrendPoint[];
  color: string;
  valueFormatter: (value: number) => string;
  goal?: number;
  showAverage?: boolean;
  floorAtZero?: boolean;
  pixelsPerDay?: number;
}

const HEIGHT = 250;
const TAP_SIZE = 44;
const PAD = { top: 22, right: 16, bottom: 30, left: 48 };

function formatDateLabel(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TrendLineChart({
  points,
  color,
  valueFormatter,
  goal,
  showAverage = false,
  floorAtZero = false,
  pixelsPerDay = 44,
}: TrendLineChartProps) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleWidth = resolveChartWidth(layoutWidth, viewportWidth, Spacing.base * 2);
  const width = resolveScrollableChartWidth(visibleWidth, points.map(point => point.date), pixelsPerDay);
  const selectedPoint = points.find(point => point.date === selectedDate) ?? null;

  useEffect(() => {
    setSelectedDate(null);
  }, [points]);

  const chart = useMemo(() => {
    if (!width || points.length === 0) return null;
    const values = points.flatMap(point => [
      point.value,
      ...(showAverage && point.average != null ? [point.average] : []),
    ]);
    const { min, max, goalVisible } = resolveChartDomain(values, goal, floorAtZero);
    const innerWidth = width - PAD.left - PAD.right;
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const positions = relativeDatePositions(points.map(point => point.date));
    const x = (index: number) => PAD.left + positions[index] * innerWidth;
    const y = (value: number) => PAD.top + ((max - value) / (max - min)) * innerHeight;
    const linePoints = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
    const averagePoints = points
      .map((point, index) => point.average == null ? null : `${x(index)},${y(point.average)}`)
      .filter(Boolean)
      .join(' ');

    return { min, max, x, y, linePoints, averagePoints, innerWidth, goalVisible };
  }, [floorAtZero, goal, points, showAverage, width]);

  if (points.length === 0) {
    return (
      <View style={styles.emptyChart}>
        <Text style={styles.emptyTitle}>Not enough data yet</Text>
        <Text style={styles.emptyText}>Log another entry and the trend will appear here.</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.chartShell}
      onLayout={event => setLayoutWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={`Interactive line chart with ${points.length} data points`}
    >
      {chart && (
        <ScrollView
          ref={scrollRef}
          horizontal
          style={styles.chartScroller}
          showsHorizontalScrollIndicator
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={[styles.chartCanvas, { width }]}>
            <Svg width={width} height={HEIGHT}>
              {[0, 0.5, 1].map(position => {
                const gridY = PAD.top + position * (HEIGHT - PAD.top - PAD.bottom);
                return (
                  <Line
                    key={position}
                    x1={PAD.left}
                    x2={PAD.left + chart.innerWidth}
                    y1={gridY}
                    y2={gridY}
                    stroke={Colors.border}
                    strokeWidth={1}
                    strokeDasharray="4 5"
                  />
                );
              })}

              {goal != null && chart.goalVisible && (
                <>
                  <Line
                    x1={PAD.left}
                    x2={PAD.left + chart.innerWidth}
                    y1={chart.y(goal)}
                    y2={chart.y(goal)}
                    stroke={Colors.warning}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                  />
                  <SvgText
                    x={PAD.left + chart.innerWidth - 2}
                    y={chart.y(goal) - 5}
                    fill={Colors.warning}
                    fontSize={10}
                    textAnchor="end"
                  >
                    Goal {valueFormatter(goal)}
                  </SvgText>
                </>
              )}

              <SvgText x={PAD.left - 8} y={PAD.top + 4} fill={Colors.textMuted} fontSize={10} textAnchor="end">
                {valueFormatter(chart.max)}
              </SvgText>
              <SvgText x={PAD.left - 8} y={HEIGHT - PAD.bottom} fill={Colors.textMuted} fontSize={10} textAnchor="end">
                {valueFormatter(chart.min)}
              </SvgText>

              {showAverage && chart.averagePoints && (
                <Polyline
                  points={chart.averagePoints}
                  fill="none"
                  stroke={Colors.text}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <Polyline
                points={chart.linePoints}
                fill="none"
                stroke={color}
                strokeWidth={showAverage ? 1.75 : 3}
                strokeOpacity={showAverage ? 0.55 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((point, index) => {
                const selected = point.date === selectedDate;
                return (
                  <Circle
                    key={`${point.date}-${index}`}
                    cx={chart.x(index)}
                    cy={chart.y(showAverage && point.average != null ? point.average : point.value)}
                    r={selected ? 6 : 3.5}
                    fill={showAverage ? Colors.text : color}
                    stroke={selected ? color : Colors.background}
                    strokeWidth={selected ? 3 : 1.5}
                  />
                );
              })}

              {points.length === 1 ? (
                <SvgText x={PAD.left + chart.innerWidth / 2} y={HEIGHT - 8} fill={Colors.textMuted} fontSize={10} textAnchor="middle">
                  {formatDateLabel(points[0].date)}
                </SvgText>
              ) : (
                <>
                  <SvgText x={PAD.left} y={HEIGHT - 8} fill={Colors.textMuted} fontSize={10} textAnchor="start">
                    {formatDateLabel(points[0].date)}
                  </SvgText>
                  <SvgText x={PAD.left + chart.innerWidth} y={HEIGHT - 8} fill={Colors.textMuted} fontSize={10} textAnchor="end">
                    {formatDateLabel(points[points.length - 1].date)}
                  </SvgText>
                </>
              )}
            </Svg>

            {points.map((point, index) => {
              const displayValue = showAverage && point.average != null ? point.average : point.value;
              return (
                <Pressable
                  key={`tap-${point.date}-${index}`}
                  style={[
                    styles.pointButton,
                    {
                      left: chart.x(index) - TAP_SIZE / 2,
                      top: chart.y(displayValue) - TAP_SIZE / 2,
                    },
                  ]}
                  onPress={() => setSelectedDate(point.date)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDateLabel(point.date)}, ${valueFormatter(point.value)}`}
                  accessibilityHint="Shows details for this data point"
                />
              );
            })}
          </View>
        </ScrollView>
      )}

      <View style={styles.chartHelpRow}>
        <Text style={styles.chartHelpText}>Tap a point for details</Text>
        {width > visibleWidth && <Text style={styles.chartHelpText}>Swipe left or right to explore</Text>}
      </View>

      {showAverage && (
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: color, opacity: 0.55 }]} />
          <Text style={styles.legendText}>Daily</Text>
          <View style={[styles.legendDot, { backgroundColor: Colors.text }]} />
          <Text style={styles.legendText}>7-day average</Text>
        </View>
      )}

      {selectedPoint && (
        <View style={styles.selectedCard} accessibilityLiveRegion="polite">
          <View style={styles.selectedHeader}>
            <View>
              <Text style={styles.selectedDate}>
                {new Date(`${selectedPoint.date}T12:00:00`).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
              <Text style={[styles.selectedValue, { color }]}>{valueFormatter(selectedPoint.value)}</Text>
            </View>
            {showAverage && selectedPoint.average != null && (
              <View style={styles.averageBadge}>
                <Text style={styles.averageBadgeLabel}>7-day average</Text>
                <Text style={styles.averageBadgeValue}>{valueFormatter(selectedPoint.average)}</Text>
              </View>
            )}
          </View>
          {!!selectedPoint.details?.length && (
            <View style={styles.detailGrid}>
              {selectedPoint.details.map(detail => (
                <View key={detail.label} style={styles.detailItem}>
                  <Text style={styles.detailLabel}>{detail.label}</Text>
                  <Text style={styles.detailValue}>{detail.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartShell: {
    minHeight: HEIGHT,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  chartScroller: { height: HEIGHT },
  chartCanvas: { height: HEIGHT, position: 'relative' },
  pointButton: {
    position: 'absolute',
    width: TAP_SIZE,
    height: TAP_SIZE,
    borderRadius: TAP_SIZE / 2,
  },
  chartHelpRow: {
    minHeight: 34,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  chartHelpText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' },
  legend: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: `${Colors.surface}E6`,
    borderRadius: Radius.full,
    paddingHorizontal: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: Spacing.sm,
  },
  legendText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
  selectedCard: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  selectedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  selectedDate: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  selectedValue: { fontSize: FontSize.xl, fontWeight: '900', marginTop: 2 },
  averageBadge: {
    alignItems: 'flex-end',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  averageBadgeLabel: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700' },
  averageBadgeValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '800', marginTop: 2 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  detailItem: {
    minWidth: '30%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  detailLabel: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700' },
  detailValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '800', marginTop: 2 },
  emptyChart: {
    minHeight: 210,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
