import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  buildSixFloorNavigationBeaconMarkers,
  fallbackAnchor,
  FloorCode,
  indoorDestinations,
  IndoorDestination,
  MapPoint,
  NavigationBeaconMarker,
  projectSixFloorMeterPointToMap,
  prototypeMaps,
} from '../data/mockIndoorDestinations';
import {getRoutePositionAtProgress} from '../data/mockRoutes';
import type {NavigationRoute} from '../data/mockRoutes';
import { loadBeaconConfig, SavedBeacon } from '../../config/beaconConfig';
import {api} from '../../services/api';
import {bleScanner} from '../../services/bleScanner';
import { MapHomeScreen } from '../screens/MapHomeScreen';
import { colors } from '../theme/tokens';

const RSSI_FLUSH_MS = 250;
const POSITION_POLL_MS = 500;

interface LivePositionResult {
  ready: boolean;
  reason?: string;
  smooth_position?: MapPoint;
}

interface BuiltNavigationRoute {
  route: NavigationRoute;
  status: string;
}

interface PathSegmentMeters {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface SixFloorPathSegment {
  startMeters: MapPoint;
  endMeters: MapPoint;
  startMap: MapPoint;
  endMap: MapPoint;
}

interface SixFloorPathProjection {
  mapPoint: MapPoint;
  meters: MapPoint;
  distance: number;
  segment: SixFloorPathSegment;
}

const getVerticalTransferPoint = (floor: FloorCode): MapPoint =>
  floor === '6F' ? {x: 77, y: 24} : {x: 66, y: 34};

const getPointDistance = (a: MapPoint, b: MapPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

function buildSixFloorPathSegments(
  pathSegments: PathSegmentMeters[],
  beaconList: SavedBeacon[]
): SixFloorPathSegment[] {
  return pathSegments
    .map((segment): SixFloorPathSegment | null => {
      const startMeters = {x: segment.x1, y: segment.y1};
      const endMeters = {x: segment.x2, y: segment.y2};
      const startMap = projectSixFloorMeterPointToMap(startMeters, beaconList);
      const endMap = projectSixFloorMeterPointToMap(endMeters, beaconList);

      if (!startMap || !endMap) {
        return null;
      }

      return {startMeters, endMeters, startMap, endMap};
    })
    .filter((segment): segment is SixFloorPathSegment => segment !== null);
}

function projectRoomOntoPathSegment(
  roomPoint: MapPoint,
  segment: SixFloorPathSegment
): SixFloorPathProjection {
  const dx = segment.endMap.x - segment.startMap.x;
  const dy = segment.endMap.y - segment.startMap.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 0
      ? 0
      : clampUnit(
          ((roomPoint.x - segment.startMap.x) * dx +
            (roomPoint.y - segment.startMap.y) * dy) /
            lengthSquared
        );
  const mapPoint = {
    x: segment.startMap.x + dx * t,
    y: segment.startMap.y + dy * t,
  };
  const meters = {
    x: segment.startMeters.x + (segment.endMeters.x - segment.startMeters.x) * t,
    y: segment.startMeters.y + (segment.endMeters.y - segment.startMeters.y) * t,
  };

  return {
    mapPoint,
    meters,
    distance: getPointDistance(roomPoint, mapPoint),
    segment,
  };
}

function isVerticalMapSegment(segment: SixFloorPathSegment) {
  return (
    Math.abs(segment.endMap.y - segment.startMap.y) >
    Math.abs(segment.endMap.x - segment.startMap.x)
  );
}

function getSegmentMidY(segment: SixFloorPathSegment) {
  return (segment.startMap.y + segment.endMap.y) / 2;
}

function getSegmentMidX(segment: SixFloorPathSegment) {
  return (segment.startMap.x + segment.endMap.x) / 2;
}

function getClosestProjection(
  projections: SixFloorPathProjection[]
): SixFloorPathProjection | null {
  return projections.reduce<SixFloorPathProjection | null>(
    (closest, projection) =>
      !closest || projection.distance < closest.distance ? projection : closest,
    null
  );
}

function getSixFloorPathAccessProjection(
  roomPoint: MapPoint,
  pathSegments: SixFloorPathSegment[]
): SixFloorPathProjection | null {
  const projections = pathSegments.map((segment) =>
    projectRoomOntoPathSegment(roomPoint, segment)
  );
  const verticalProjections = projections.filter((projection) =>
    isVerticalMapSegment(projection.segment)
  );
  const horizontalProjections = projections.filter(
    (projection) => !isVerticalMapSegment(projection.segment)
  );
  const topProjection = getClosestProjection(
    horizontalProjections.filter(
      (projection) =>
        getSegmentMidY(projection.segment) ===
        Math.min(...horizontalProjections.map((item) => getSegmentMidY(item.segment)))
    )
  );
  const bottomProjection = getClosestProjection(
    horizontalProjections.filter(
      (projection) =>
        getSegmentMidY(projection.segment) ===
        Math.max(...horizontalProjections.map((item) => getSegmentMidY(item.segment)))
    )
  );
  const verticalProjection = getClosestProjection(verticalProjections);

  if (topProjection && roomPoint.y <= topProjection.mapPoint.y + 4) {
    return topProjection;
  }

  if (bottomProjection && roomPoint.y >= bottomProjection.mapPoint.y + 3) {
    return bottomProjection;
  }

  if (verticalProjection) {
    const verticalX = getSegmentMidX(verticalProjection.segment);
    const topY = topProjection?.mapPoint.y ?? 0;
    const bottomY = bottomProjection?.mapPoint.y ?? 100;

    if (
      roomPoint.x >= verticalX - 14 &&
      roomPoint.x <= verticalX + 8 &&
      roomPoint.y >= topY - 4 &&
      roomPoint.y <= bottomY + 2
    ) {
      return verticalProjection;
    }
  }

  if (topProjection && roomPoint.y <= topProjection.mapPoint.y + 14) {
    return topProjection;
  }

  if (bottomProjection && roomPoint.y >= bottomProjection.mapPoint.y - 8) {
    return bottomProjection;
  }

  return getClosestProjection(projections);
}

function buildFallbackNavigationRoute(
  source: IndoorDestination,
  destination: IndoorDestination,
): NavigationRoute {
  const segments =
    source.floor === destination.floor
      ? [
          {
            floor: source.floor,
            points: [source.mapPoint, destination.mapPoint],
          },
        ]
      : [
          {
            floor: source.floor,
            points: [source.mapPoint, getVerticalTransferPoint(source.floor)],
          },
          {
            floor: destination.floor,
            points: [
              getVerticalTransferPoint(destination.floor),
              destination.mapPoint,
            ],
          },
        ];

  return {
    id: `route-${source.id}-to-${destination.id}`,
    name: `${source.name} to ${destination.name}`,
    segments,
  };
}

function canonicalizeRawEvents(
  events: ReturnType<typeof bleScanner.drainRawEvents>,
  beacons: SavedBeacon[]
) {
  const byIBeacon = new Map<string, string>();
  const byNameLower = new Map<string, string>();
  const knownIds = new Set<string>();

  for (const beacon of beacons) {
    knownIds.add(beacon.id);
    if (beacon.name) {
      byNameLower.set(beacon.name.trim().toLowerCase(), beacon.id);
    }
    for (const alias of beacon.aliases ?? []) {
      byNameLower.set(alias.trim().toLowerCase(), beacon.id);
    }
    if (
      beacon.uuid &&
      beacon.major !== undefined &&
      beacon.minor !== undefined
    ) {
      byIBeacon.set(
        `${beacon.uuid.toUpperCase()}|${beacon.major}|${beacon.minor}`,
        beacon.id
      );
    }
  }

  return events
    .map((event) => {
      let canonicalId: string | undefined;

      if (
        event.ibeacon_uuid &&
        event.ibeacon_major !== null &&
        event.ibeacon_major !== undefined &&
        event.ibeacon_minor !== null &&
        event.ibeacon_minor !== undefined
      ) {
        canonicalId = byIBeacon.get(
          `${event.ibeacon_uuid.toUpperCase()}|${event.ibeacon_major}|${event.ibeacon_minor}`
        );
      }

      if (!canonicalId && event.beacon_name) {
        canonicalId = byNameLower.get(event.beacon_name.trim().toLowerCase());
      }

      if (!canonicalId && knownIds.has(event.beacon_id)) {
        canonicalId = event.beacon_id;
      }

      if (!canonicalId) {
        return null;
      }

      return {
        beacon_id: canonicalId,
        beacon_name: event.beacon_name,
        rssi: event.rssi,
        ibeacon_uuid: event.ibeacon_uuid ?? null,
        ibeacon_major: event.ibeacon_major ?? null,
        ibeacon_minor: event.ibeacon_minor ?? null,
      };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);
}

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
  const [livePosition, setLivePosition] = useState<MapPoint | null>(null);
  const [navigationRoute, setNavigationRoute] = useState<NavigationRoute | null>(
    null
  );
  const [navigationRouteStatus, setNavigationRouteStatus] = useState(
    'Choose a source and destination to route through the walkable path.'
  );
  const [liveStatusMessage, setLiveStatusMessage] = useState(
    'Starting live BLE position...'
  );
  const fpSessionIdRef = useRef(
    `navigation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      let flushInterval: ReturnType<typeof setInterval> | null = null;
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let beaconList: SavedBeacon[] = [];
      const sessionId = fpSessionIdRef.current;

      const cleanup = () => {
        if (flushInterval) {
          clearInterval(flushInterval);
          flushInterval = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        bleScanner.drainRawEvents();
      };

      const startLivePosition = async () => {
        setLiveStatusMessage('Starting live BLE position...');
        const config = await loadBeaconConfig();
        beaconList = Object.values(config);

        if (cancelled) {
          return;
        }

        bleScanner.setBeaconKalmanConfig(config);
        setBeaconMarkers(buildSixFloorNavigationBeaconMarkers(beaconList));
        setLivePosition(null);

        await api.fpStart({sigma_a: 0.5, seed_r_from_loo: true}, sessionId);

        if (cancelled) {
          return;
        }

        bleScanner.drainRawEvents();
        unsubscribe = bleScanner.subscribe(() => {});
        setLiveStatusMessage('Listening for live BLE position...');

        flushInterval = setInterval(async () => {
          const events = bleScanner.drainRawEvents();
          if (events.length === 0) {
            return;
          }

          const filteredEvents = canonicalizeRawEvents(events, beaconList);
          if (filteredEvents.length === 0) {
            return;
          }

          try {
            await api.fpRssiEvents(filteredEvents, sessionId);
          } catch (error: any) {
            if (!cancelled) {
              setLiveStatusMessage(`RSSI stream error: ${error?.message ?? error}`);
            }
          }
        }, RSSI_FLUSH_MS);

        pollInterval = setInterval(async () => {
          try {
            const position = (await api.fpPositionLatest(
              sessionId
            )) as LivePositionResult;

            if (cancelled) {
              return;
            }

            if (!position.ready || !position.smooth_position) {
              setLivePosition(null);
              setLiveStatusMessage(
                position.reason ?? 'Waiting for overlapping beacon readings...'
              );
              return;
            }

            const mapPoint = projectSixFloorMeterPointToMap(
              position.smooth_position,
              beaconList
            );
            setLivePosition(mapPoint);
            setLiveStatusMessage('Live position constrained to the walkable path.');
          } catch (error: any) {
            if (!cancelled) {
              setLiveStatusMessage(`Position poll error: ${error?.message ?? error}`);
            }
          }
        }, POSITION_POLL_MS);
      };

      startLivePosition().catch((error: any) => {
        if (!cancelled) {
          setLivePosition(null);
          setLiveStatusMessage(`Live position unavailable: ${error?.message ?? error}`);
        }
      });

      return () => {
        cancelled = true;
        cleanup();
        api.fpReset(sessionId).catch(() => {});
      };
    }, [])
  );

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
  const statusMessage = isNavigating
    ? navigationRouteStatus
    : livePosition
    ? liveStatusMessage
    : beaconMarkers.length > 0
    ? liveStatusMessage
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
    () =>
      navigationRoute
        ? getRoutePositionAtProgress(navigationRoute, routeProgress)
        : null,
    [navigationRoute, routeProgress]
  );

  const clearNavigationRoute = () => {
    setNavigationRoute(null);
    setNavigationRouteStatus(
      'Choose a source and destination to route through the walkable path.'
    );
  };

  const buildSixFloorNavigationRoute = async (
    source: IndoorDestination,
    destination: IndoorDestination,
  ): Promise<BuiltNavigationRoute | null> => {
    const config = await loadBeaconConfig();
    const beaconList = Object.values(config);
    setBeaconMarkers(buildSixFloorNavigationBeaconMarkers(beaconList));

    const path = await api.fpPathGet();
    const pathSegments = buildSixFloorPathSegments(
      path.segments ?? [],
      beaconList
    );
    const startAccess = getSixFloorPathAccessProjection(
      source.mapPoint,
      pathSegments
    );
    const endAccess = getSixFloorPathAccessProjection(
      destination.mapPoint,
      pathSegments
    );

    if (!startAccess || !endAccess) {
      return null;
    }

    if (getPointDistance(startAccess.meters, endAccess.meters) < 0.01) {
      return {
        route: {
          id: `route-${source.id}-to-${destination.id}`,
          name: `${source.name} to ${destination.name}`,
          segments: [
            {
              floor: '6F',
              points: [startAccess.mapPoint, endAccess.mapPoint],
            },
          ],
        },
        status: `${source.name} to ${destination.name}: same 6F path access point.`,
      };
    }

    const route = await api.fpRoutePoints(
      {
        id: source.id,
        name: source.name,
        x: startAccess.meters.x,
        y: startAccess.meters.y,
      },
      {
        id: destination.id,
        name: destination.name,
        x: endAccess.meters.x,
        y: endAccess.meters.y,
      }
    );
    const routePoints = route.waypoints
      .map((waypoint) => projectSixFloorMeterPointToMap(waypoint, beaconList))
      .filter((point): point is MapPoint => point !== null);

    if (routePoints.length < 2) {
      return null;
    }

    return {
      route: {
        id: `route-${source.id}-to-${destination.id}`,
        name: `${source.name} to ${destination.name}`,
        segments: [{floor: '6F', points: routePoints}],
      },
      status: route.reachable
        ? `${source.name} to ${destination.name}: ${route.length.toFixed(
            1
          )} m along the 6F walkable path.`
        : `${source.name} to ${destination.name}: ${
            route.reason ?? 'walkable path unavailable'
          }; showing the direct connector.`,
    };
  };

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
    clearNavigationRoute();
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
    clearNavigationRoute();
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
    clearNavigationRoute();
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
    clearNavigationRoute();
  };

  const handleStartNavigation = async () => {
    if (
      !visibleSource ||
      !visibleDestination ||
      visibleSource.id === visibleDestination.id
    ) {
      return;
    }

    let builtRoute: BuiltNavigationRoute | null = null;

    if (visibleSource.floor === '6F' && visibleDestination.floor === '6F') {
      try {
        builtRoute = await buildSixFloorNavigationRoute(
          visibleSource,
          visibleDestination
        );
      } catch (error: any) {
        builtRoute = {
          route: buildFallbackNavigationRoute(visibleSource, visibleDestination),
          status: `6F route service unavailable: ${
            error?.message ?? error
          }; showing a temporary direct connector.`,
        };
      }
    }

    if (!builtRoute) {
      builtRoute = {
        route: buildFallbackNavigationRoute(visibleSource, visibleDestination),
        status:
          visibleSource.floor === '6F' && visibleDestination.floor === '6F'
            ? '6F path transform unavailable; showing a temporary direct connector.'
            : 'Path-constrained routing is ready for 6F. This route is a temporary connector until the 8F path graph is added.',
      };
    }

    const startPosition = getRoutePositionAtProgress(builtRoute.route, 0);

    setSelectedFloor(startPosition.floor);
    setNavigationRoute(builtRoute.route);
    setNavigationRouteStatus(builtRoute.status);
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
    clearNavigationRoute();
  };

  const handleRefocusNavigation = () => {
    if (!visibleSource && !isNavigating) {
      return;
    }

    setSelectedFloor(
      isNavigating ? routePosition?.floor ?? selectedFloor : visibleSource!.floor
    );
    setMapFocusRequest((request) => request + 1);
  };

  const handleChangeRouteProgress = (progress: number) => {
    if (!navigationRoute) {
      return;
    }

    const nextProgress = Math.min(100, Math.max(0, progress));
    const nextPosition = getRoutePositionAtProgress(
      navigationRoute,
      nextProgress
    );

    setRouteProgress(nextProgress);
    setSelectedFloor(nextPosition.floor);
  };

  const handleStepRouteProgress = (delta: number) => {
    if (!navigationRoute) {
      return;
    }

    setRouteProgress((currentProgress) => {
      const nextProgress = Math.min(100, Math.max(0, currentProgress + delta));
      const nextPosition = getRoutePositionAtProgress(
        navigationRoute,
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
          livePosition={livePosition}
          source={visibleSource}
          destination={visibleDestination}
          selectedFloor={selectedFloor}
          onChangeFloor={setSelectedFloor}
          statusMessage={statusMessage}
          isLocating={false}
          isNavigating={isNavigating}
          activeStepIndex={activeStepIndex}
          routeProgress={routeProgress}
          navigationRoute={isNavigating ? navigationRoute : null}
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
