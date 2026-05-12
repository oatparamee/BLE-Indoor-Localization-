import React from 'react';
import {View, Text, StyleSheet, Dimensions} from 'react-native';
import Svg, {Polyline, Line, Text as SvgText} from 'react-native-svg';

const SCREEN_WIDTH = Dimensions.get('window').width;
const Y_AXIS_WIDTH = 32;
const CHART_WIDTH = SCREEN_WIDTH - 64 - Y_AXIS_WIDTH; // card padding + y-axis
const CHART_HEIGHT = 90;
const RSSI_MIN = -100;
const RSSI_MAX = -30;
const Y_LABELS = [-40, -60, -80, -100];

function toPoints(data: number[], width: number, height: number): string {
  if (data.length < 2) return '';
  const n = data.length;
  return data
    .map((v, i) => {
      const x = (i / (n - 1)) * width;
      const clamped = Math.max(RSSI_MIN, Math.min(RSSI_MAX, v));
      const y = ((RSSI_MAX - clamped) / (RSSI_MAX - RSSI_MIN)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

interface Props {
  rawHistory: number[];
  smoothedHistory: number[];
}

export default function RssiLineChart({rawHistory, smoothedHistory}: Props) {
  if (rawHistory.length < 2) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Collecting samples…</Text>
      </View>
    );
  }

  const rawPoints = toPoints(rawHistory, CHART_WIDTH, CHART_HEIGHT);
  const smoothedPoints = toPoints(smoothedHistory, CHART_WIDTH, CHART_HEIGHT);

  return (
    <View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, {backgroundColor: '#f0883e'}]} />
          <Text style={styles.legendText}>Raw RSSI</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, {backgroundColor: '#3fb950'}]} />
          <Text style={styles.legendText}>After 1D KF</Text>
        </View>
      </View>

      <View style={styles.chartRow}>
        {/* Y-axis labels */}
        <View style={[styles.yAxis, {height: CHART_HEIGHT}]}>
          {Y_LABELS.map(label => {
            const pct = (RSSI_MAX - label) / (RSSI_MAX - RSSI_MIN);
            return (
              <Text
                key={label}
                style={[styles.yLabel, {top: pct * CHART_HEIGHT - 6}]}>
                {label}
              </Text>
            );
          })}
        </View>

        {/* Chart */}
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          {/* Grid lines */}
          {Y_LABELS.map(label => {
            const y =
              ((RSSI_MAX - label) / (RSSI_MAX - RSSI_MIN)) * CHART_HEIGHT;
            return (
              <Line
                key={label}
                x1={0}
                y1={y}
                x2={CHART_WIDTH}
                y2={y}
                stroke="#21262d"
                strokeWidth={1}
              />
            );
          })}

          {/* Raw RSSI — orange, thin, slightly transparent */}
          {rawPoints ? (
            <Polyline
              points={rawPoints}
              fill="none"
              stroke="#f0883e"
              strokeWidth={1.5}
              opacity={0.7}
            />
          ) : null}

          {/* Smoothed RSSI — green, thicker */}
          {smoothedPoints ? (
            <Polyline
              points={smoothedPoints}
              fill="none"
              stroke="#3fb950"
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#6e7681',
    fontSize: 12,
    fontStyle: 'italic',
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: '#8b949e',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    position: 'relative',
  },
  yLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 9,
    color: '#6e7681',
    fontFamily: 'monospace',
  },
});
