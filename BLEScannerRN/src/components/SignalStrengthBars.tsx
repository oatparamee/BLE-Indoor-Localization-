/**
 * SignalStrengthBars Component
 *
 * Renders 1–4 ascending bars (like a Wi-Fi icon) to visually represent
 * BLE signal strength. Filled bars use the signal color; unfilled bars
 * are light gray.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

interface Props {
  /** Number of bars to fill (1–4). */
  bars: number;
  /** Color for the filled bars. */
  color: string;
}

const TOTAL_BARS = 4;

export const SignalStrengthBars: React.FC<Props> = ({ bars, color }) => {
  return (
    <View style={styles.container}>
      {/* Draw each bar as a progressively taller rectangle. */}
      {Array.from({ length: TOTAL_BARS }, (_, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              // Each bar is taller than the previous one.
              height: 8 + index * 5,
              // Filled bars get the signal color; empty bars are gray.
              backgroundColor: index < bars ? color : '#E0E0E0',
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    width: 6,
    borderRadius: 2,
  },
});
