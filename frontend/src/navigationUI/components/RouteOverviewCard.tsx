import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CurrentAnchor,
  IndoorDestination,
} from '../data/mockIndoorDestinations';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  currentAnchor: CurrentAnchor;
  destination: IndoorDestination;
  isLocating: boolean;
  isNavigating: boolean;
  activeStepIndex: number;
  routeProgress: number;
  statusMessage: string;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
}

export function RouteOverviewCard({
  currentAnchor,
  destination,
  isLocating,
  isNavigating,
  activeStepIndex,
  routeProgress,
  statusMessage,
  onStartNavigation,
  onStopNavigation,
}: Props) {
  const canNavigate = destination.routeSteps.length > 1;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{destination.name}</Text>
          <Text style={styles.subtitle}>
            From {currentAnchor.label} to {destination.floor} in about {destination.etaMinutes} min
          </Text>
        </View>

        <View style={styles.etaPill}>
          <Text style={styles.etaText}>{destination.distanceMeters} m</Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View
          style={[
            styles.signalDot,
            { backgroundColor: isLocating ? colors.success : colors.warning },
          ]}
        />
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepLabel}>
          {isNavigating ? `Step ${activeStepIndex + 1}` : 'Next step'}
        </Text>
        <Text style={styles.stepText}>
          {destination.routeSteps[Math.min(activeStepIndex, destination.routeSteps.length - 1)]}
        </Text>
      </View>

      {isNavigating ? (
        <View style={styles.progressCard}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${routeProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{routeProgress}% complete</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={isNavigating ? onStopNavigation : onStartNavigation}
        disabled={!canNavigate}
        style={[
          styles.primaryAction,
          isNavigating && styles.primaryActionActive,
          !canNavigate && styles.primaryActionDisabled,
        ]}
      >
        <Text style={styles.primaryActionText}>
          {isNavigating ? 'End navigation preview' : canNavigate ? 'Start navigation' : 'Path pending'}
        </Text>
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
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  etaPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceMuted,
  },
  etaText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  signalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  stepCard: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },
  stepLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  stepText: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  progressCard: {
    gap: spacing.xs,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accentStrong,
  },
  progressText: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  primaryAction: {
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  primaryActionActive: {
    backgroundColor: colors.accentStrong,
  },
  primaryActionDisabled: {
    backgroundColor: colors.textMuted,
  },
  primaryActionText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.surface,
  },
});
