import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  buildSixFloorNavigationBeaconMarkers,
  fallbackAnchor,
  FloorCode,
  indoorDestinations,
  NavigationBeaconMarker,
  prototypeMaps,
} from '../data/mockIndoorDestinations';
import {
  boelterDemoRoute,
  getRoutePositionAtProgress,
} from '../data/mockRoutes';
import { loadBeaconConfig } from '../../config/beaconConfig';
import { MapHomeScreen } from '../screens/MapHomeScreen';
import { colors } from '../theme/tokens';

export function IndoorNavigatorApp() {
  const defaultMap = prototypeMaps[0] ?? null;
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedMapId, setSelectedMapId] = useState<string | null>(defaultMap?.id ?? null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>('boelter-6266-suite');
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(
    'engineering-library'
  );
  const [selectedFloor, setSelectedFloor] = useState<FloorCode>(
    defaultMap?.defaultFloor ?? '6F'
  );
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [routeProgress, setRouteProgress] = useState(0);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const [beaconMarkers, setBeaconMarkers] = useState<NavigationBeaconMarker[]>([]);
  const deferredMapSearchQuery = useDeferredValue(mapSearchQuery);
  const deferredRoomSearchQuery = useDeferredValue(roomSearchQuery);

  const mapById = useMemo(
    () => new Map(prototypeMaps.map((mapZone) => [mapZone.id, mapZone])),
    []
  );
  const destinationById = useMemo(
    () => new Map(indoorDestinations.map((destination) => [destination.id, destination])),
    []
  );

  useEffect(() => {
    let cancelled = false;

    loadBeaconConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }

        const markers = buildSixFloorNavigationBeaconMarkers(Object.values(config));
        setBeaconMarkers(markers);
      })
      .catch(() => {
        if (!cancelled) {
          setBeaconMarkers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentAnchor = useMemo(() => {
    const topLeftBeacon =
      beaconMarkers.find((marker) => marker.label === 'BCPro_1') ??
      beaconMarkers[0];

    if (!topLeftBeacon) {
      return fallbackAnchor;
    }

    return {
      label: topLeftBeacon.label,
      subtitle: '6F beacon anchor on the navigation map',
      floor: topLeftBeacon.floor,
      point: topLeftBeacon.point,
    };
  }, [beaconMarkers]);
  const statusMessage =
    beaconMarkers.length > 0
      ? `Showing ${beaconMarkers.length} mapped 6F beacon anchors.`
      : '6F beacon anchors will appear here after beacon setup loads.';

  const filteredMaps = useMemo(() => {
    const normalizedQuery = deferredMapSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return prototypeMaps;
    }

    return prototypeMaps.filter((mapZone) =>
      `${mapZone.name} ${mapZone.subtitle}`.toLowerCase().includes(normalizedQuery)
    );
  }, [deferredMapSearchQuery]);

  const selectedMap = selectedMapId
    ? mapById.get(selectedMapId) ?? null
    : null;

  const mapDestinations = useMemo(() => {
    if (!selectedMap) {
      return [];
    }

    return indoorDestinations.filter(
      (destination) => destination.mapId === selectedMap.id
    );
  }, [selectedMap]);

  const filteredRooms = useMemo(() => {
    const normalizedQuery = deferredRoomSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return mapDestinations;
    }

    return mapDestinations.filter((destination) =>
      [
        destination.name,
        destination.subtitle,
        destination.floor,
        destination.category,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [deferredRoomSearchQuery, mapDestinations]);

  const quickRooms = useMemo(() => {
    const quickAccessRooms = mapDestinations.filter((destination) => destination.quickAccess);
    return (quickAccessRooms.length > 0 ? quickAccessRooms : mapDestinations).slice(0, 4);
  }, [mapDestinations]);

  const selectedDestination = selectedDestinationId
    ? destinationById.get(selectedDestinationId) ?? null
    : null;
  const selectedSource = selectedSourceId
    ? destinationById.get(selectedSourceId) ?? null
    : null;
  const visibleSource =
    selectedSource && selectedSource.mapId === selectedMapId
      ? selectedSource
      : null;
  const visibleDestination =
    selectedDestination && selectedDestination.mapId === selectedMapId
      ? selectedDestination
      : null;
  const routePosition = useMemo(
    () => getRoutePositionAtProgress(boelterDemoRoute, routeProgress),
    [routeProgress]
  );

  const handleSelectMap = (mapId: string) => {
    const nextMap = mapById.get(mapId);
    if (!nextMap) {
      return;
    }

    setSelectedMapId(mapId);
    setSelectedFloor(nextMap.defaultFloor);
    setSelectedSourceId(null);
    setSelectedDestinationId(null);
    setMapSearchQuery('');
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
    setRouteProgress(0);
  };

  const handleClearMapSelection = () => {
    setSelectedMapId(null);
    setSelectedSourceId(null);
    setSelectedDestinationId(null);
    setSelectedFloor(defaultMap?.defaultFloor ?? '6F');
    setMapSearchQuery('');
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
    setRouteProgress(0);
  };

  const handleSelectDestination = (destinationId: string) => {
    const destination = destinationById.get(destinationId);
    if (!destination || destination.mapId !== selectedMapId) {
      return;
    }

    setSelectedDestinationId(destinationId);
    setSelectedFloor(destination.floor);
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
    setRouteProgress(0);
  };

  const handleSelectSource = (destinationId: string) => {
    const source = destinationById.get(destinationId);
    if (!source || source.mapId !== selectedMapId) {
      return;
    }

    setSelectedSourceId(destinationId);
    setSelectedFloor(source.floor);
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
    setRouteProgress(0);
  };

  const handleStartNavigation = () => {
    if (!visibleSource || !visibleDestination) {
      return;
    }

    const startPosition = getRoutePositionAtProgress(boelterDemoRoute, 0);

    setSelectedFloor(startPosition.floor);
    setIsNavigating(true);
    setActiveStepIndex(0);
    setRouteProgress(0);
    setRoomSearchQuery('');
    setMapFocusRequest((request) => request + 1);
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    setActiveStepIndex(0);
    setRouteProgress(0);
  };

  const handleRefocusNavigation = () => {
    if (!visibleSource && !isNavigating) {
      return;
    }

    setSelectedFloor(isNavigating ? routePosition.floor : visibleSource!.floor);
    setMapFocusRequest((request) => request + 1);
  };

  const handleChangeRouteProgress = (progress: number) => {
    const nextProgress = Math.min(100, Math.max(0, progress));
    const nextPosition = getRoutePositionAtProgress(
      boelterDemoRoute,
      nextProgress
    );

    setRouteProgress(nextProgress);
    setSelectedFloor(nextPosition.floor);
  };

  const handleStepRouteProgress = (delta: number) => {
    setRouteProgress((currentProgress) => {
      const nextProgress = Math.min(100, Math.max(0, currentProgress + delta));
      const nextPosition = getRoutePositionAtProgress(
        boelterDemoRoute,
        nextProgress
      );

      setSelectedFloor(nextPosition.floor);
      return nextProgress;
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <View style={styles.shell}>
        <MapHomeScreen
          mapSearchQuery={mapSearchQuery}
          onChangeMapSearchQuery={setMapSearchQuery}
          maps={filteredMaps}
          selectedMap={selectedMap}
          roomSearchQuery={roomSearchQuery}
          onChangeRoomSearchQuery={setRoomSearchQuery}
          roomResults={filteredRooms}
          quickRooms={quickRooms}
          currentAnchor={currentAnchor}
          beaconMarkers={beaconMarkers}
          source={visibleSource}
          destination={visibleDestination}
          selectedFloor={selectedFloor}
          onChangeFloor={setSelectedFloor}
          statusMessage={statusMessage}
          isLocating={false}
          isNavigating={isNavigating}
          activeStepIndex={activeStepIndex}
          routeProgress={routeProgress}
          navigationRoute={isNavigating ? boelterDemoRoute : null}
          routePosition={isNavigating ? routePosition : null}
          onSelectMap={handleSelectMap}
          onClearMapSelection={handleClearMapSelection}
          onSelectSource={handleSelectSource}
          onSelectDestination={handleSelectDestination}
          onStartNavigation={handleStartNavigation}
          onStopNavigation={handleStopNavigation}
          onRefocusNavigation={handleRefocusNavigation}
          onChangeRouteProgress={handleChangeRouteProgress}
          onStepRouteProgress={handleStepRouteProgress}
          mapFocusRequest={mapFocusRequest}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    flex: 1,
  },
});
