import React from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {
  CurrentAnchor,
  FloorCode,
  IndoorDestination,
  MapPoint,
  NavigationBeaconMarker,
  PrototypeMapZone,
} from '../data/mockIndoorDestinations';
import type {NavigationRoute} from '../data/mockRoutes';
import {IndoorMapPlaceholder} from '../components/IndoorMapPlaceholder';
import {
  colors,
  radii,
  spacing,
  shadows,
  typography,
} from '../theme/tokens';

function RefocusArrowIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5L19 5L11.5 19L9.4 14.6L5 12.5Z"
        stroke={colors.accentStrong}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
      />
    </Svg>
  );
}

function ChevronDownIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 9L12 15L18 9"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

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
  beaconMarkers: NavigationBeaconMarker[];
  livePosition: MapPoint | null;
  source: IndoorDestination | null;
  destination: IndoorDestination | null;
  selectedFloor: FloorCode;
  onChangeFloor: (floor: FloorCode) => void;
  statusMessage: string;
  isLocating: boolean;
  isNavigating: boolean;
  activeStepIndex: number;
  navigationRoute: NavigationRoute | null;
  onSelectMap: (mapId: string) => void;
  onClearMapSelection: () => void;
  onSelectSource: (destinationId: string) => void;
  onSelectDestination: (destinationId: string) => void;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onRefocusNavigation: () => void;
  mapFocusRequest: number;
}

export function MapHomeScreen({
  roomSearchQuery,
  onChangeRoomSearchQuery,
  roomResults,
  currentAnchor,
  beaconMarkers,
  livePosition,
  source,
  destination,
  selectedFloor,
  onChangeFloor,
  statusMessage,
  isNavigating,
  navigationRoute,
  onSelectDestination,
  onStartNavigation,
  onStopNavigation,
  onRefocusNavigation,
  mapFocusRequest,
}: Props) {
  const searchIsActive = roomSearchQuery.trim().length > 0;
  const visibleRoomResults = searchIsActive ? roomResults : [];
  const canStartNavigation = Boolean(destination && livePosition);
  const [hasSearchedRooms, setHasSearchedRooms] = React.useState(false);
  const [floorMenuOpen, setFloorMenuOpen] = React.useState(false);
  const floors: FloorCode[] = ['6F', '8F'];

  React.useEffect(() => {
    if (searchIsActive) {
      setHasSearchedRooms(true);
    }
  }, [searchIsActive]);

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  const dismissTransientUi = () => {
    Keyboard.dismiss();
    setFloorMenuOpen(false);
  };

  const handleSelectDestination = (destinationId: string) => {
    dismissTransientUi();
    onSelectDestination(destinationId);
  };

  const handleNavigationPress = () => {
    dismissTransientUi();

    if (isNavigating) {
      onStopNavigation();
      return;
    }

    if (canStartNavigation) {
      onStartNavigation();
    }
  };

  return (
    <View style={styles.container}>
      <IndoorMapPlaceholder
        style={styles.mapCanvas}
        floor={selectedFloor}
        currentAnchor={currentAnchor}
        destination={destination}
        beaconMarkers={beaconMarkers}
        livePosition={livePosition}
        zoneName="Boelter 6F to 8F"
        showRooms
        isNavigating={isNavigating}
        navigationRoute={navigationRoute}
        onInteractionStart={dismissTransientUi}
        focusPoint={livePosition ?? source?.mapPoint ?? currentAnchor.point}
        focusRequest={mapFocusRequest}
      />

      {!isNavigating ? (
        <View style={styles.searchOverlay}>
          <View style={styles.searchPanel}>
            <TextInput
              accessibilityLabel="Search Boelter rooms and landmarks"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={onChangeRoomSearchQuery}
              placeholder="Search rooms, elevators, stairs"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              onSubmitEditing={dismissKeyboard}
              style={styles.searchInput}
              value={roomSearchQuery}
            />

            {hasSearchedRooms ? (
              <View style={styles.selectionStack}>
                <View style={styles.selectionChip}>
                  <Text style={styles.selectionLabel}>From</Text>
                  <Text numberOfLines={1} style={styles.selectionValue}>
                    {livePosition ? 'Live position | 6F' : 'Waiting for live dot'}
                  </Text>
                </View>
                <View style={styles.selectionChip}>
                  <Text style={styles.selectionLabel}>To</Text>
                  <Text numberOfLines={1} style={styles.selectionValue}>
                    {destination
                      ? `${destination.name} | ${destination.floor}`
                      : 'Choose destination'}
                  </Text>
                </View>
              </View>
            ) : null}

            {searchIsActive ? (
              <ScrollView
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={visibleRoomResults.length > 4}
                style={styles.resultsList}
                contentContainerStyle={styles.resultsContent}>
                {visibleRoomResults.length > 0 ? (
                  visibleRoomResults.map((room) => (
                    <View key={room.id} style={styles.resultRow}>
                      <View style={styles.resultTextBlock}>
                        <Text numberOfLines={1} style={styles.resultName}>
                          {room.name}
                        </Text>
                        <Text numberOfLines={1} style={styles.resultMeta}>
                          {room.floor} | {room.category}
                        </Text>
                      </View>

                      <View style={styles.resultActions}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleSelectDestination(room.id)}
                          style={[
                            styles.resultAction,
                            destination?.id === room.id &&
                              styles.resultActionActive,
                          ]}>
                          <Text
                            style={[
                              styles.resultActionText,
                              destination?.id === room.id &&
                                styles.resultActionTextActive,
                            ]}>
                            Dest
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyResults}>No matching rooms yet.</Text>
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      ) : null}

      {isNavigating ? (
        <View pointerEvents="box-none" style={styles.directionsOverlay}>
          <View style={styles.directionsPanel}>
            <Text numberOfLines={2} style={styles.directionsText}>
              {statusMessage}
            </Text>
          </View>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.floorOverlay}>
        {floorMenuOpen ? (
          <View style={styles.floorMenu}>
            {floors.map((floor) => {
              const active = floor === selectedFloor;

              return (
                <Pressable
                  key={floor}
                  accessibilityRole="button"
                  onPress={() => {
                    dismissKeyboard();
                    setFloorMenuOpen(false);
                    onChangeFloor(floor);
                  }}
                  style={[
                    styles.floorMenuItem,
                    active && styles.floorMenuItemActive,
                  ]}>
                  <Text
                    style={[
                      styles.floorMenuItemText,
                      active && styles.floorMenuItemTextActive,
                    ]}>
                    {floor}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            dismissKeyboard();
            setFloorMenuOpen((open) => !open);
          }}
          style={styles.floorButton}>
          <Text style={styles.floorButtonText}>{selectedFloor}</Text>
          <ChevronDownIcon />
        </Pressable>
      </View>

      {isNavigating ? (
        <View pointerEvents="box-none" style={styles.refocusOverlay}>
          <Pressable
            accessibilityLabel="Refocus map"
            accessibilityRole="button"
            onPress={() => {
              dismissTransientUi();
              onRefocusNavigation();
            }}
            style={styles.refocusButton}>
            <RefocusArrowIcon />
          </Pressable>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.navigationOverlay}>
        <Pressable
          accessibilityRole="button"
          disabled={!canStartNavigation && !isNavigating}
          onPress={handleNavigationPress}
          style={[
            styles.startButton,
            (!canStartNavigation && !isNavigating) &&
              styles.startButtonDisabled,
          ]}>
          <Text
            style={[
              styles.startButtonText,
              (!canStartNavigation && !isNavigating) &&
                styles.startButtonTextDisabled,
            ]}>
            {isNavigating ? 'Stop' : 'Start'}
          </Text>
        </Pressable>
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
  searchOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
  },
  searchPanel: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    ...shadows,
  },
  searchInput: {
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
  },
  directionsOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
  },
  directionsPanel: {
    minHeight: 58,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows,
  },
  directionsText: {
    color: colors.textPrimary,
    fontSize: typography.section,
    fontWeight: '800',
  },
  selectionStack: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  selectionChip: {
    minHeight: 42,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectionLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  selectionValue: {
    marginTop: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  resultsList: {
    maxHeight: 260,
    marginTop: spacing.sm,
  },
  resultsContent: {
    gap: spacing.xs,
  },
  resultRow: {
    minHeight: 58,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resultTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  resultMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  resultActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  resultAction: {
    minWidth: 54,
    minHeight: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  resultActionActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  resultActionText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  resultActionTextActive: {
    color: colors.accentStrong,
  },
  emptyResults: {
    color: colors.textMuted,
    fontSize: typography.body,
    fontWeight: '600',
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  floorOverlay: {
    position: 'absolute',
    right: spacing.md,
    bottom: 162,
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  floorMenu: {
    minWidth: 76,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
    ...shadows,
  },
  floorMenuItem: {
    minHeight: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  floorMenuItemActive: {
    backgroundColor: colors.accentSoft,
  },
  floorMenuItemText: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  floorMenuItemTextActive: {
    color: colors.accentStrong,
  },
  floorButton: {
    minWidth: 76,
    minHeight: 48,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    ...shadows,
  },
  floorButtonText: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.accentStrong,
  },
  refocusOverlay: {
    position: 'absolute',
    right: spacing.md,
    bottom: 104,
  },
  refocusButton: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows,
  },
  navigationOverlay: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.md,
    right: spacing.md,
  },
  startButton: {
    minHeight: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    ...shadows,
  },
  startButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  startButtonText: {
    color: colors.surface,
    fontSize: typography.section,
    fontWeight: '900',
  },
  startButtonTextDisabled: {
    color: colors.textMuted,
  },
});
