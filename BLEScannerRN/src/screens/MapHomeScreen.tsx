import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  CurrentAnchor,
  IndoorDestination,
  PrototypeMapZone,
} from '../data/mockIndoorDestinations';
import { IndoorMapPlaceholder } from '../components/IndoorMapPlaceholder';
import { RouteOverviewCard } from '../components/RouteOverviewCard';
import {
  colors,
  radii,
  shadows,
  spacing,
  typography,
} from '../theme/tokens';

interface Props {
  mapSearchQuery: string;
  onChangeMapSearchQuery: (value: string) => void;
  maps: PrototypeMapZone[];
  selectedMap: PrototypeMapZone | null;
  roomSearchQuery: string;
  onChangeRoomSearchQuery: (value: string) => void;
  roomResults: IndoorDestination[];
  quickRooms: IndoorDestination[];
  currentAnchor: CurrentAnchor;
  destination: IndoorDestination | null;
  selectedFloor: 'L1' | 'L2' | 'L3';
  onChangeFloor: (floor: 'L1' | 'L2' | 'L3') => void;
  statusMessage: string;
  isLocating: boolean;
  isNavigating: boolean;
  activeStepIndex: number;
  routeProgress: number;
  onSelectMap: (mapId: string) => void;
  onClearMapSelection: () => void;
  onSelectDestination: (destinationId: string) => void;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
}

export function MapHomeScreen({
  mapSearchQuery,
  onChangeMapSearchQuery,
  maps,
  selectedMap,
  roomSearchQuery,
  onChangeRoomSearchQuery,
  roomResults,
  quickRooms,
  currentAnchor,
  destination,
  selectedFloor,
  onChangeFloor,
  statusMessage,
  isLocating,
  isNavigating,
  activeStepIndex,
  routeProgress,
  onSelectMap,
  onClearMapSelection,
  onSelectDestination,
  onStartNavigation,
  onStopNavigation,
}: Props) {
  const searchInputRef = useRef<TextInput>(null);
  const [searchMode, setSearchMode] = useState<'map' | 'destination'>(
    selectedMap ? 'destination' : 'map'
  );
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);
  const trimmedMapSearch = mapSearchQuery.trim();
  const trimmedRoomSearch = roomSearchQuery.trim();
  const showingMapResults = !isNavigating && (!selectedMap || searchMode === 'map');
  const showingRoomResults =
    !isNavigating && !!selectedMap && searchMode === 'destination' && trimmedRoomSearch.length > 0;
  const roomResultsToShow = roomResults.slice(0, 5);
  const suggestedRooms = quickRooms.slice(0, 4);
  const activeSearchValue =
    !selectedMap || searchMode === 'map' ? mapSearchQuery : roomSearchQuery;
  const activeSearchPlaceholder =
    !selectedMap || searchMode === 'map'
      ? 'Search demo maps'
      : `Search destination in ${selectedMap.name}`;
  const currentInstruction =
    destination?.routeSteps[Math.min(activeStepIndex, destination.routeSteps.length - 1)] ?? '';
  const collapsedPillTitle = !selectedMap
    ? 'Choose a demo map'
    : destination
      ? destination.name
      : showingRoomResults
        ? `${roomResultsToShow.length} destination results`
        : 'Quick destinations';
  const collapsedPillBody = !selectedMap
    ? 'Tap to pick the map zone'
    : destination
      ? `${destination.etaMinutes} min | ${destination.distanceMeters} m | Tap for route`
      : showingRoomResults
        ? 'Tap to view matches'
        : `${selectedMap.name} | Tap to open`;

  useEffect(() => {
    if (!selectedMap) {
      setSearchMode('map');
    }
  }, [selectedMap]);

  useEffect(() => {
    setBottomSheetExpanded(false);
  }, [selectedMap?.id, isNavigating]);

  const focusSearchBar = () => {
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);
  };

  const handleActivateMapSearch = () => {
    onClearMapSelection();
    setSearchMode('map');
    focusSearchBar();
  };

  const handleChangeSearch = (value: string) => {
    if (!selectedMap || searchMode === 'map') {
      onChangeMapSearchQuery(value);
      return;
    }

    onChangeRoomSearchQuery(value);
  };

  const handleSubmitSearch = () => {
    if (!selectedMap || searchMode === 'map') {
      if (maps[0]) {
        onSelectMap(maps[0].id);
        setSearchMode('destination');
        focusSearchBar();
      }
      return;
    }

    if (roomResults[0]) {
      onSelectDestination(roomResults[0].id);
    }
  };

  const handleSelectMapResult = (mapId: string) => {
    onSelectMap(mapId);
    setSearchMode('destination');
    focusSearchBar();
  };

  return (
    <View style={styles.container}>
      <IndoorMapPlaceholder
        style={styles.mapCanvas}
        floor={selectedFloor}
        currentAnchor={currentAnchor}
        destination={destination}
        zoneName={selectedMap?.name ?? 'No active map'}
        showRooms={!!selectedMap}
        isNavigating={isNavigating}
        routeProgress={routeProgress}
      />

      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topOverlay}>
          {isNavigating && destination ? (
            <View style={styles.guidanceBanner}>
              <View style={styles.guidanceCopy}>
                <Text style={styles.guidanceEyebrow}>Navigating to {destination.name}</Text>
                <Text style={styles.guidanceText}>{currentInstruction}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onStopNavigation}
                style={styles.guidanceButton}
              >
                <Text style={styles.guidanceButtonText}>End</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.searchShell}>
                <TextInput
                  ref={searchInputRef}
                  placeholder={activeSearchPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  value={activeSearchValue}
                  onChangeText={handleChangeSearch}
                  onSubmitEditing={handleSubmitSearch}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
              </View>

              {showingMapResults ? (
                <View style={styles.resultsOverlay}>
                  <Text style={styles.resultsTitle}>
                    {selectedMap ? 'Switch maps' : 'Choose a map'}
                  </Text>
                  {maps.length === 0 ? (
                    <Text style={styles.emptyText}>No prototype maps match that search.</Text>
                  ) : (
                    maps.map((mapZone) => (
                      <Pressable
                        key={mapZone.id}
                        accessibilityRole="button"
                        onPress={() => handleSelectMapResult(mapZone.id)}
                        style={styles.mapResultCard}
                      >
                        <Text style={styles.resultTitle}>{mapZone.name}</Text>
                        <Text style={styles.resultBody}>{mapZone.subtitle}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              ) : (
                <View style={styles.metaRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleActivateMapSearch}
                    style={styles.mapChip}
                  >
                    <Text style={styles.mapChipLabel}>Active map</Text>
                    <Text style={styles.mapChipValue}>
                      {selectedMap?.name ?? 'No active map'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </View>

        <View style={styles.floorOverlay}>
          {(['L1', 'L2', 'L3'] as const).map((floor) => {
            const active = floor === selectedFloor;

            return (
              <Pressable
                key={floor}
                accessibilityRole="button"
                onPress={() => onChangeFloor(floor)}
                style={[
                  styles.floorButton,
                  !selectedMap && styles.floorButtonDisabled,
                  active && styles.floorButtonActive,
                ]}
                disabled={!selectedMap}
              >
                <Text style={[styles.floorButtonText, active && styles.floorButtonTextActive]}>
                  {floor}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {bottomSheetExpanded && !isNavigating ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close bottom panel"
            onPress={() => setBottomSheetExpanded(false)}
            style={styles.dismissBackdrop}
          />
        ) : null}

        <View pointerEvents="box-none" style={styles.bottomOverlay}>
          {isNavigating && destination ? null : !bottomSheetExpanded ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setBottomSheetExpanded(true)}
              style={styles.collapsedPill}
            >
              <View style={styles.collapsedPillHandle} />
              <View style={styles.collapsedPillCopy}>
                <Text style={styles.collapsedPillTitle}>{collapsedPillTitle}</Text>
                <Text style={styles.collapsedPillBody}>{collapsedPillBody}</Text>
              </View>
            </Pressable>
          ) : !selectedMap ? (
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View style={styles.sheetCopy}>
                  <Text style={styles.sheetEyebrow}>No active map</Text>
                  <Text style={styles.sheetTitle}>Start by choosing a demo zone</Text>
                  <Text style={styles.sheetBody}>
                    Use the top search bar to select the map you want to showcase.
                  </Text>
                </View>
              </View>
            </View>
          ) : destination && !showingRoomResults ? (
            <View style={styles.bottomStack}>
              <RouteOverviewCard
                currentAnchor={currentAnchor}
                destination={destination}
                isLocating={isLocating}
                isNavigating={isNavigating}
                activeStepIndex={activeStepIndex}
                routeProgress={routeProgress}
                statusMessage={statusMessage}
                onStartNavigation={onStartNavigation}
                onStopNavigation={onStopNavigation}
              />
            </View>
          ) : (
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View style={styles.sheetCopy}>
                  <Text style={styles.sheetEyebrow}>{selectedMap.name}</Text>
                  <Text style={styles.sheetTitle}>Search destinations from the top bar</Text>
                  <Text style={styles.sheetBody}>
                    Use the single search bar for rooms. Tap the active map chip if you want to
                    switch zones.
                  </Text>
                </View>
              </View>

              {showingRoomResults ? (
                roomResultsToShow.length === 0 ? (
                  <Text style={styles.emptyText}>No rooms match that search yet.</Text>
                ) : (
                  <View style={styles.roomResultsList}>
                    {roomResultsToShow.map((room) => (
                      <Pressable
                        key={room.id}
                        accessibilityRole="button"
                        onPress={() => onSelectDestination(room.id)}
                        style={styles.roomResultCard}
                      >
                        <Text style={styles.resultTitle}>{room.name}</Text>
                        <Text style={styles.resultMeta}>
                          {room.floor} | {room.category} | {room.etaMinutes} min
                        </Text>
                        <Text style={styles.resultBody}>{room.subtitle}</Text>
                      </Pressable>
                    ))}
                  </View>
                )
              ) : (
                <View style={styles.suggestedSection}>
                  <Text style={styles.suggestedLabel}>Quick rooms</Text>
                  <View style={styles.quickRoomsRow}>
                    {suggestedRooms.map((room) => (
                      <Pressable
                        key={room.id}
                        accessibilityRole="button"
                        onPress={() => onSelectDestination(room.id)}
                        style={styles.quickRoomChip}
                      >
                        <Text style={styles.quickRoomChipText}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  mapCanvas: {
    flex: 1,
    borderRadius: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  topOverlay: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    gap: spacing.sm,
  },
  searchShell: {
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    paddingHorizontal: spacing.md,
    ...shadows,
  },
  searchInput: {
    fontSize: typography.body,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
  },
  resultsOverlay: {
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows,
  },
  resultsTitle: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  mapResultCard: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metaRow: {
    alignItems: 'flex-start',
  },
  mapChip: {
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  mapChipLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  mapChipValue: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  resultTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  resultMeta: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  resultBody: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  floorOverlay: {
    position: 'absolute',
    right: spacing.md,
    top: 140,
    gap: spacing.sm,
  },
  floorButton: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
  },
  floorButtonDisabled: {
    opacity: 0.45,
  },
  floorButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  floorButtonText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  floorButtonTextActive: {
    color: colors.accentStrong,
  },
  bottomOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  bottomStack: {
    gap: spacing.sm,
  },
  dismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  collapsedPill: {
    minHeight: 58,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows,
  },
  collapsedPillHandle: {
    width: 38,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  collapsedPillCopy: {
    flex: 1,
    gap: 2,
  },
  collapsedPillTitle: {
    fontSize: typography.section,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  collapsedPillBody: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  guidanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadows,
  },
  guidanceCopy: {
    flex: 1,
    gap: 4,
  },
  guidanceEyebrow: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  guidanceText: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  guidanceButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  guidanceButtonText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.surface,
  },
  sheet: {
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows,
  },
  sheetHeader: {
    gap: spacing.sm,
  },
  sheetCopy: {
    gap: 4,
  },
  sheetEyebrow: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.accentStrong,
    textTransform: 'uppercase',
  },
  sheetTitle: {
    fontSize: typography.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sheetBody: {
    fontSize: typography.body,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  roomResultsList: {
    gap: spacing.sm,
  },
  roomResultCard: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },
  suggestedSection: {
    gap: spacing.sm,
  },
  suggestedLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  quickRoomsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickRoomChip: {
    borderRadius: radii.pill,
    backgroundColor: colors.accentMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quickRoomChipText: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.accentStrong,
  },
  emptyText: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
});
