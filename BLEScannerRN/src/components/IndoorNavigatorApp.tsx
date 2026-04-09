import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  beaconAnchors,
  fallbackAnchor,
  indoorDestinations,
  prototypeMaps,
} from '../data/mockIndoorDestinations';
import { MapHomeScreen } from '../screens/MapHomeScreen';
import { BLEScannerController, ScannerDataMode } from '../utils/types';
import { colors } from '../theme/tokens';

interface Props {
  controller: BLEScannerController;
  dataMode: ScannerDataMode;
}

export function IndoorNavigatorApp({ controller, dataMode }: Props) {
  const defaultMap = prototypeMaps[0] ?? null;
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedMapId, setSelectedMapId] = useState<string | null>(defaultMap?.id ?? null);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<'L1' | 'L2' | 'L3'>(
    defaultMap?.defaultFloor ?? 'L2'
  );
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const deferredMapSearchQuery = useDeferredValue(mapSearchQuery);
  const deferredRoomSearchQuery = useDeferredValue(roomSearchQuery);

  const { devices, isScanning, statusMessage, startScanning } = controller;

  useEffect(() => {
    if (dataMode === 'mock' && !isScanning) {
      startScanning();
    }
  }, [dataMode, isScanning, startScanning]);

  const mapById = useMemo(
    () => new Map(prototypeMaps.map((mapZone) => [mapZone.id, mapZone])),
    []
  );
  const destinationById = useMemo(
    () => new Map(indoorDestinations.map((destination) => [destination.id, destination])),
    []
  );

  const strongestDevice = devices[0] ?? null;
  const currentAnchor = strongestDevice
    ? beaconAnchors[strongestDevice.id] ?? fallbackAnchor
    : fallbackAnchor;

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
  const visibleDestination =
    selectedDestination && selectedDestination.mapId === selectedMapId
      ? selectedDestination
      : null;

  const routeProgress =
    isNavigating && visibleDestination
      ? Math.round(
          ((activeStepIndex + 1) / Math.max(visibleDestination.routeSteps.length, 1)) * 100
        )
      : 0;

  const handleSelectMap = (mapId: string) => {
    const nextMap = mapById.get(mapId);
    if (!nextMap) {
      return;
    }

    setSelectedMapId(mapId);
    setSelectedFloor(nextMap.defaultFloor);
    setSelectedDestinationId(null);
    setMapSearchQuery('');
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
  };

  const handleClearMapSelection = () => {
    setSelectedMapId(null);
    setSelectedDestinationId(null);
    setSelectedFloor(defaultMap?.defaultFloor ?? 'L2');
    setMapSearchQuery('');
    setRoomSearchQuery('');
    setIsNavigating(false);
    setActiveStepIndex(0);
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
  };

  useEffect(() => {
    if (!isNavigating || !visibleDestination || dataMode !== 'mock') {
      return;
    }

    if (activeStepIndex >= visibleDestination.routeSteps.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setActiveStepIndex((currentStep) =>
        Math.min(currentStep + 1, visibleDestination.routeSteps.length - 1)
      );
    }, 2800);

    return () => clearTimeout(timer);
  }, [activeStepIndex, dataMode, isNavigating, visibleDestination]);

  const handleStartNavigation = () => {
    if (!visibleDestination) {
      return;
    }

    setIsNavigating(true);
    setActiveStepIndex(0);
  };

  const handleStopNavigation = () => {
    setIsNavigating(false);
    setActiveStepIndex(0);
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
          destination={visibleDestination}
          selectedFloor={selectedFloor}
          onChangeFloor={setSelectedFloor}
          statusMessage={statusMessage}
          isLocating={isScanning}
          isNavigating={isNavigating}
          activeStepIndex={activeStepIndex}
          routeProgress={routeProgress}
          onSelectMap={handleSelectMap}
          onClearMapSelection={handleClearMapSelection}
          onSelectDestination={handleSelectDestination}
          onStartNavigation={handleStartNavigation}
          onStopNavigation={handleStopNavigation}
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
