import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WorkspaceTab } from '../utils/types';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

const tabCopy: Record<WorkspaceTab, { label: string; hint: string }> = {
  scanner: {
    label: 'Scanner',
    hint: 'Nearby devices',
  },
  signalLab: {
    label: 'Signal Lab',
    hint: 'Filter tuning',
  },
};

export function TopTabBar({ activeTab, onChange }: Props) {
  return (
    <View style={styles.container}>
      {(['scanner', 'signalLab'] as WorkspaceTab[]).map((tab) => {
        const active = tab === activeTab;
        return (
          <Pressable
            key={tab}
            accessibilityRole="button"
            onPress={() => onChange(tab)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {tabCopy[tab].label}
            </Text>
            <Text style={[styles.hint, active && styles.hintActive]}>
              {tabCopy[tab].hint}
            </Text>
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
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  tabActive: {
    backgroundColor: colors.accentMuted,
  },
  label: {
    fontSize: typography.section,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.textPrimary,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  hintActive: {
    color: colors.accentStrong,
  },
});
