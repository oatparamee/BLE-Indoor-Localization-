import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { IndoorDestination } from '../data/mockIndoorDestinations';
import { PlaceCard } from '../components/PlaceCard';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  searchQuery: string;
  onChangeSearchQuery: (value: string) => void;
  destinations: IndoorDestination[];
  selectedDestinationId: string;
  onOpenDestination: (destinationId: string) => void;
}

const categoryOrder = ['Study', 'Lab', 'Food', 'Amenity', 'Support'] as const;

export function PlacesScreen({
  searchQuery,
  onChangeSearchQuery,
  destinations,
  selectedDestinationId,
  onOpenDestination,
}: Props) {
  const featuredDestinations = destinations.slice(0, 3);
  const categoryCounts = categoryOrder
    .map((category) => ({
      category,
      count: destinations.filter((destination) => destination.category === category).length,
    }))
    .filter(({ count }) => count > 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Directory</Text>
        <Text style={styles.title}>Browse rooms, labs, amenities, and shared spaces</Text>
        <Text style={styles.subtitle}>
          The directory becomes the fastest way to swap routes once real building
          data is connected to the app.
        </Text>

        <TextInput
          placeholder="Search the building directory"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={onChangeSearchQuery}
          style={styles.searchInput}
        />

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Visible places</Text>
            <Text style={styles.summaryValue}>{destinations.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Most direct route</Text>
            <Text style={styles.summaryValue}>
              {destinations[0]?.etaMinutes ?? '-'} min
            </Text>
          </View>
        </View>
      </View>

      {categoryCounts.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <Text style={styles.sectionMeta}>Snapshot of this building pack</Text>
          </View>

          <View style={styles.categoryWrap}>
            {categoryCounts.map(({ category, count }) => (
              <View key={category} style={styles.categoryChip}>
                <Text style={styles.categoryChipLabel}>{category}</Text>
                <Text style={styles.categoryChipCount}>{count}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {featuredDestinations.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Suggested destinations</Text>
            <Text style={styles.sectionMeta}>Fastest to preview right now</Text>
          </View>

          <View style={styles.featuredList}>
            {featuredDestinations.map((destination) => (
              <Pressable
                key={destination.id}
                accessibilityRole="button"
                onPress={() => onOpenDestination(destination.id)}
                style={[
                  styles.featuredCard,
                  destination.id === selectedDestinationId && styles.featuredCardSelected,
                ]}
              >
                <Text style={styles.featuredName}>{destination.name}</Text>
                <Text style={styles.featuredMeta}>
                  {destination.floor} | {destination.category}
                </Text>
                <Text style={styles.featuredHint}>{destination.routeSteps[0]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Available places</Text>
        <Text style={styles.sectionMeta}>{destinations.length} results</Text>
      </View>

      {destinations.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No matching places</Text>
          <Text style={styles.emptyBody}>
            Try a room number, category, or landmark such as cafe, elevator, or lab.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {destinations.map((destination) => (
            <PlaceCard
              key={destination.id}
              destination={destination}
              selected={destination.id === selectedDestinationId}
              onPress={() => onOpenDestination(destination.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  eyebrow: {
    fontSize: typography.eyebrow,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  searchInput: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: 4,
  },
  summaryLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  summaryValue: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionMeta: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryChipLabel: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  categoryChipCount: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.accentStrong,
  },
  featuredList: {
    gap: spacing.md,
  },
  featuredCard: {
    borderRadius: radii.lg,
    backgroundColor: '#F7FCFA',
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  featuredCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  featuredName: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  featuredMeta: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  featuredHint: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  emptyCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.md,
  },
});
