import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IndoorDestination } from '../data/mockIndoorDestinations';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  destination: IndoorDestination;
  selected?: boolean;
  actionLabel?: string;
  detail?: string;
  onPress: () => void;
}

export function PlaceCard({
  destination,
  selected = false,
  actionLabel = 'Preview route',
  detail,
  onPress,
}: Props) {
  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.name}>{destination.name}</Text>
          <Text style={styles.subtitle}>{destination.subtitle}</Text>
        </View>
        <View style={styles.etaPill}>
          <Text style={styles.etaText}>{destination.etaMinutes} min</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{destination.floor}</Text>
        <Text style={styles.metaDot}>|</Text>
        <Text style={styles.metaText}>{destination.category}</Text>
        <Text style={styles.metaDot}>|</Text>
        <Text style={styles.metaText}>{destination.distanceMeters} m</Text>
      </View>

      <Text style={styles.detailText}>{detail ?? destination.routeSteps[0]}</Text>

      <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
        <Text style={styles.actionText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: '#FCFEFE',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  etaPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accentMuted,
  },
  etaText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.accentStrong,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  metaDot: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  detailText: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  action: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
});
