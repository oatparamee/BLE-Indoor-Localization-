import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  IndoorDestination,
  SavedPlace,
} from '../data/mockIndoorDestinations';
import { PlaceCard } from '../components/PlaceCard';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  favorites: SavedPlace[];
  recents: SavedPlace[];
  destinationById: Map<string, IndoorDestination>;
  onOpenDestination: (destinationId: string) => void;
}

function SavedSection({
  title,
  subtitle,
  entries,
  destinationById,
  onOpenDestination,
}: {
  title: string;
  subtitle: string;
  entries: SavedPlace[];
  destinationById: Map<string, IndoorDestination>;
  onOpenDestination: (destinationId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{subtitle}</Text>
      </View>

      <View style={styles.list}>
        {entries.map((entry) => {
          const destination = destinationById.get(entry.destinationId);
          if (!destination) {
            return null;
          }

          return (
            <PlaceCard
              key={entry.id}
              destination={destination}
              detail={entry.note}
              actionLabel="Open route"
              onPress={() => onOpenDestination(destination.id)}
            />
          );
        })}
      </View>
    </View>
  );
}

export function SavedScreen({
  favorites,
  recents,
  destinationById,
  onOpenDestination,
}: Props) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Saved</Text>
        <Text style={styles.title}>Keep routes and building data ready offline</Text>
        <Text style={styles.subtitle}>
          This tab can later expand into downloaded building packs, account sync,
          and accessibility preferences, but the core offline structure is already here.
        </Text>
      </View>

      <View style={styles.downloadCard}>
        <Text style={styles.downloadTitle}>Offline building packs</Text>
        <Text style={styles.downloadBody}>
          Engineering Hall, South Atrium, and Student Commons are marked as cached
          for immediate indoor route previews.
        </Text>

        <View style={styles.downloadStats}>
          <View style={styles.downloadStatCard}>
            <Text style={styles.downloadStatLabel}>Cached floors</Text>
            <Text style={styles.downloadStatValue}>9</Text>
          </View>
          <View style={styles.downloadStatCard}>
            <Text style={styles.downloadStatLabel}>Recent sync</Text>
            <Text style={styles.downloadStatValue}>Today</Text>
          </View>
          <View style={styles.downloadStatCard}>
            <Text style={styles.downloadStatLabel}>Storage</Text>
            <Text style={styles.downloadStatValue}>42 MB</Text>
          </View>
        </View>
      </View>

      <View style={styles.statusStrip}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipLabel}>Favorites</Text>
          <Text style={styles.statusChipValue}>{favorites.length}</Text>
        </View>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipLabel}>Recent trips</Text>
          <Text style={styles.statusChipValue}>{recents.length}</Text>
        </View>
      </View>

      <SavedSection
        title="Favorites"
        subtitle="Pinned destinations"
        entries={favorites}
        destinationById={destinationById}
        onOpenDestination={onOpenDestination}
      />

      <SavedSection
        title="Recent trips"
        subtitle="Latest route previews"
        entries={recents}
        destinationById={destinationById}
        onOpenDestination={onOpenDestination}
      />
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
  downloadCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.textPrimary,
    padding: spacing.lg,
    gap: spacing.md,
  },
  downloadTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.surface,
  },
  downloadBody: {
    fontSize: typography.body,
    lineHeight: 21,
    color: '#D4DEEA',
  },
  downloadStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  downloadStatCard: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: spacing.md,
    gap: 4,
  },
  downloadStatLabel: {
    fontSize: typography.caption,
    color: '#AFC0D0',
  },
  downloadStatValue: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.surface,
  },
  statusStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusChip: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  statusChipLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  statusChipValue: {
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
  list: {
    gap: spacing.md,
  },
});
