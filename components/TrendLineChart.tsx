import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { Colors, FontSize, Radius, Spacing } from '../constants/theme';
import { relativeDatePositions, resolveChartDomain, resolveChartWidth } from '../utils/trends';

export interface LineTrendPoint {
  date: string;
  value: number;
  average?: number;
}

interface TrendLineChartProps {
  points: LineTrendPoint[];
  color: string;
  valueFormatter: (value: number) => string;
  goal?: number;
  showAverage?: boolean;
  floorAtZero?: boolean;
}

const HEIGHT = 250;
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
}: TrendLineChartProps) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const { width: viewportWidth } = useWindowDimensions();
  const width = resolveChartWidth(layoutWidth, viewportWidth, Spacing.base * 2);

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
      accessibilityLabel={`Line chart with ${points.length} data points`}
    >
      {chart && (
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
          {points.map((point, index) => (
            <Circle
              key={`${point.date}-${index}`}
              cx={chart.x(index)}
              cy={chart.y(showAverage && point.average != null ? point.average : point.value)}
              r={3.5}
              fill={showAverage ? Colors.text : color}
              stroke={Colors.background}
              strokeWidth={1.5}
            />
          ))}

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
      )}
      {showAverage && (
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: color, opacity: 0.55 }]} />
          <Text style={styles.legendText}>Daily</Text>
          <View style={[styles.legendDot, { backgroundColor: Colors.text }]} />
          <Text style={styles.legendText}>7-day average</Text>
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
  legend: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
