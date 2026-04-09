import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadows, spacing, typography } from '../theme/tokens';

export type NavigationTab = 'map' | 'places' | 'saved';

interface Props {
  activeTab: NavigationTab;
  onChangeTab: (tab: NavigationTab) => void;
}

const tabs: Array<{ id: NavigationTab; label: string; hint: string }> = [
  { id: 'map', label: 'Map', hint: 'Route view' },
  { id: 'places', label: 'Places', hint: 'Directory' },
  { id: 'saved', label: 'Saved', hint: 'Recent trips' },
];

export function BottomTabBar({ activeTab, onChangeTab }: Props) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;

        return (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            onPress={() => onChangeTab(tab.id)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
            <Text style={[styles.hint, active && styles.hintActive]}>{tab.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows,
  },
  tab: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabActive: {
    backgroundColor: colors.accentSoft,
  },
  label: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.accentStrong,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  hintActive: {
    color: colors.accentStrong,
  },
});
