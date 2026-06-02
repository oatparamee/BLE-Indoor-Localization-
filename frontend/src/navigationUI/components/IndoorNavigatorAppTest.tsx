import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
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
import { colors, radii, shadows, spacing, typography } from '../theme/tokens';

const RSSI_FLUSH_MS = 250;
const POSITION_POLL_MS = 250;
const FLOOR_DETECT_MS = 1500;
const FLOOR_RSSI_FRESHNESS_MS = 3000;
const FLOOR_VOTE_WINDOW = 5;
const FLOOR_VOTE_THRESHOLD = 3;

interface LivePositionResult {
  ready: boolean;
  reason?: string;
  smooth_position?: MapPoint;
}

interface BuiltNavigationRoute {
  route: NavigationRoute;
  status: string;
}

interface NavigationEndpoint {
  id: string;
  name: string;
  floor: FloorCode;
  mapPoint: MapPoint;
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

interface RecordingSample {
  meters: MapPoint;
  mapPoint: MapPoint;
  timestamp: number;
}

const SIX_FLOOR_ELEVATOR_2_ID = '6f-elevator-2';
const EIGHT_FLOOR_ELEVATOR_2_ID = '8f-elevator-2';

const getVerticalTransferPoint = (floor: FloorCode): MapPoint =>
  floor === '6F' ? {x: 77, y: 24} : {x: 66, y: 34};

const getPointDistance = (a: MapPoint, b: MapPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

function isSelectableNavigationDestination(destination: IndoorDestination) {
  return destination.floor !== '8F' || destination.id === 'engineering-library';
}

function toNavigationEndpoint(destination: IndoorDestination): NavigationEndpoint {
  return {
    id: destination.id,
    name: destination.name,
    floor: destination.floor,
    mapPoint: destination.mapPoint,
  };
}

function mergeRoutes(
  id: string,
  name: string,
  routes: NavigationRoute[]
): NavigationRoute {
  return {
    id,
    name,
    segments: routes.flatMap((route) => route.segments),
  };
}

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
  source: NavigationEndpoint,
  destination: NavigationEndpoint,
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

function buildEightFloorHallwayRoute(
  source: NavigationEndpoint,
  destination: NavigationEndpoint
): BuiltNavigationRoute {
  const start = source.mapPoint;
  const end = destination.mapPoint;
  const points: MapPoint[] = [start];
  const mainHallX = 66;
  const eastHallX = 77;
  const westHallX = 34;
  const topHallY = 35;
  const libraryHallY = 53;
  const southHallY = 80;

  const pushPoint = (pointToAdd: MapPoint) => {
    const lastPoint = points[points.length - 1];
    if (
      Math.abs(lastPoint.x - pointToAdd.x) > 0.01 ||
      Math.abs(lastPoint.y - pointToAdd.y) > 0.01
    ) {
      points.push(pointToAdd);
    }
  };

  if (end.x <= 42) {
    pushPoint({x: mainHallX, y: topHallY});
    pushPoint({x: westHallX, y: topHallY});
    pushPoint({x: westHallX, y: end.y});
  } else if (end.y >= 72) {
    pushPoint({x: mainHallX, y: southHallY});
    pushPoint({x: end.x, y: southHallY});
  } else if (end.x >= 72) {
    pushPoint({x: mainHallX, y: libraryHallY});
    pushPoint({x: eastHallX, y: libraryHallY});
    pushPoint({x: eastHallX, y: end.y});
  } else {
    pushPoint({x: mainHallX, y: end.y});
  }

  pushPoint(end);

  return {
    route: {
      id: `route-${source.id}-to-${destination.id}`,
      name: `${source.name} to ${destination.name}`,
      segments: [{floor: '8F', points}],
    },
    status: `${source.name} to ${destination.name}: using the 8F hallway guide from Elevator 2.`,
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

export function IndoorNavigatorAppTest() {
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

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSamples, setRecordingSamples] = useState<RecordingSample[]>([]);
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const fpSessionIdRef = useRef(
    `test-navigation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const latestRawRssiRef = useRef<Map<string, {rssi: number; ts: number}>>(
    new Map()
  );
  const floorVotesRef = useRef<(6 | 8 | null)[]>([]);
  const autoFloorRef = useRef<FloorCode | null>(null);
  const isNavigatingRef = useRef(false);
  const [detectedFloor, setDetectedFloor] = useState<FloorCode | null>(null);
  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);
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
      let floorDetectInterval: ReturnType<typeof setInterval> | null = null;
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
        if (floorDetectInterval) {
          clearInterval(floorDetectInterval);
          floorDetectInterval = null;
        }
        latestRawRssiRef.current.clear();
        floorVotesRef.current = [];
        autoFloorRef.current = null;
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

          const nowTs = Date.now();
          for (const event of events) {
            const key = event.beacon_name || event.beacon_id;
            if (!key || typeof event.rssi !== 'number') {
              continue;
            }
            latestRawRssiRef.current.set(key, {rssi: event.rssi, ts: nowTs});
          }
          for (const [key, value] of latestRawRssiRef.current) {
            if (nowTs - value.ts > FLOOR_RSSI_FRESHNESS_MS) {
              latestRawRssiRef.current.delete(key);
            }
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

        floorDetectInterval = setInterval(async () => {
          const nowTs = Date.now();
          const rssi: Record<string, number> = {};
          for (const [key, value] of latestRawRssiRef.current) {
            if (nowTs - value.ts <= FLOOR_RSSI_FRESHNESS_MS) {
              rssi[key] = value.rssi;
            }
          }
          if (Object.keys(rssi).length === 0) {
            return;
          }

          let result;
          try {
            result = await api.floorDetect(rssi);
          } catch {
            return;
          }
          if (cancelled) {
            return;
          }

          floorVotesRef.current.push(result.floor);
          if (floorVotesRef.current.length > FLOOR_VOTE_WINDOW) {
            floorVotesRef.current.shift();
          }
          const eightVotes = floorVotesRef.current.filter((v) => v === 8).length;
          const sixVotes = floorVotesRef.current.filter((v) => v === 6).length;
          let nextFloor: FloorCode | null = null;
          if (eightVotes >= FLOOR_VOTE_THRESHOLD) {
            nextFloor = '8F';
          } else if (sixVotes >= FLOOR_VOTE_THRESHOLD) {
            nextFloor = '6F';
          }
          if (!nextFloor || nextFloor === autoFloorRef.current) {
            return;
          }
          autoFloorRef.current = nextFloor;
          setDetectedFloor(nextFloor);
          if (!isNavigatingRef.current) {
            setSelectedFloor(nextFloor);
          }
        }, FLOOR_DETECT_MS);

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

            const meters = position.smooth_position;
            const mapPoint = projectSixFloorMeterPointToMap(meters, beaconList);
            setLivePosition(mapPoint);
            setLiveStatusMessage('Live position constrained to the walkable path.');

            if (isRecordingRef.current && mapPoint) {
              setRecordingSamples((prev) => [
                ...prev,
                {meters, mapPoint, timestamp: Date.now()},
              ]);
            }
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
  const floorBadge = detectedFloor ? ` [auto-detected ${detectedFloor}]` : '';
  const statusMessage = isNavigating
    ? `${navigationRouteStatus}${floorBadge}`
    : livePosition
    ? `${liveStatusMessage}${floorBadge}`
    : beaconMarkers.length > 0
    ? `${liveStatusMessage}${floorBadge}`
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
      (destination) =>
        destination.mapId === selectedMap.id &&
        isSelectableNavigationDestination(destination)
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

  const totalDistance = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < recordingSamples.length; i++) {
      const a = recordingSamples[i - 1].meters;
      const b = recordingSamples[i].meters;
      sum += Math.hypot(a.x - b.x, a.y - b.y);
    }
    return sum;
  }, [recordingSamples]);

  const elapsedSeconds = useMemo(() => {
    if (recordingSamples.length < 2) {
      return 0;
    }
    const first = recordingSamples[0].timestamp;
    const last = recordingSamples[recordingSamples.length - 1].timestamp;
    return (last - first) / 1000;
  }, [recordingSamples]);

  const startSample = recordingSamples[0] ?? null;
  const latestSample = recordingSamples[recordingSamples.length - 1] ?? null;

  const displacement = useMemo(() => {
    if (!startSample || !latestSample) {
      return 0;
    }
    return getPointDistance(startSample.meters, latestSample.meters);
  }, [startSample, latestSample]);

  const clearNavigationRoute = () => {
    setNavigationRoute(null);
    setNavigationRouteStatus(
      'Choose a source and destination to route through the walkable path.'
    );
  };

  const buildSixFloorNavigationRoute = async (
    source: NavigationEndpoint,
    destination: NavigationEndpoint,
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

  const buildSixToEightNavigationRoute = async (
    source: NavigationEndpoint,
    destination: IndoorDestination
  ): Promise<BuiltNavigationRoute | null> => {
    const sixFloorElevator = destinationById.get(SIX_FLOOR_ELEVATOR_2_ID);
    const eightFloorElevator = destinationById.get(EIGHT_FLOOR_ELEVATOR_2_ID);

    if (!sixFloorElevator || !eightFloorElevator) {
      return null;
    }

    const sixFloorRoute = await buildSixFloorNavigationRoute(
      source,
      toNavigationEndpoint(sixFloorElevator)
    );

    if (!sixFloorRoute) {
      return null;
    }

    const eightFloorRoute = buildEightFloorHallwayRoute(
      toNavigationEndpoint(eightFloorElevator),
      toNavigationEndpoint(destination)
    );

    return {
      route: mergeRoutes(
        `route-${source.id}-to-${destination.id}`,
        `${source.name} to ${destination.name}`,
        [sixFloorRoute.route, eightFloorRoute.route]
      ),
      status: `${source.name} to ${destination.name}: follow the 6F path to Elevator 2, then continue from 8F Elevator 2.`,
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
    if (
      !destination ||
      destination.mapId !== selectedMapId ||
      !isSelectableNavigationDestination(destination)
    ) {
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
    if (!livePosition || !visibleDestination) {
      return;
    }

    const liveSource: NavigationEndpoint = {
      id: 'live-position',
      name: 'Current location',
      floor: '6F',
      mapPoint: livePosition,
    };
    let builtRoute: BuiltNavigationRoute | null = null;

    try {
      if (visibleDestination.floor === '6F') {
        builtRoute = await buildSixFloorNavigationRoute(
          liveSource,
          visibleDestination
        );
      } else {
        builtRoute = await buildSixToEightNavigationRoute(
          liveSource,
          visibleDestination
        );
      }
    } catch (error: any) {
      builtRoute = {
        route: buildFallbackNavigationRoute(liveSource, visibleDestination),
        status: `Route service unavailable: ${
          error?.message ?? error
        }; showing a temporary connector.`,
      };
    }

    if (!builtRoute) {
      builtRoute = {
        route: buildFallbackNavigationRoute(liveSource, visibleDestination),
        status:
          visibleDestination.floor === '6F'
            ? '6F path transform unavailable; showing a temporary direct connector.'
            : 'Elevator 2 transfer route unavailable; showing a temporary connector.',
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
    if (!livePosition && !visibleSource && !isNavigating) {
      return;
    }

    setSelectedFloor(
      isNavigating
        ? routePosition?.floor ?? selectedFloor
        : livePosition
        ? '6F'
        : visibleSource!.floor
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

  const recordingStartedAtRef = useRef<number | null>(null);
  const [lastSavedRecording, setLastSavedRecording] = useState<string | null>(
    null
  );

  const handleStartRecording = () => {
    setRecordingSamples([]);
    setLastSavedRecording(null);
    recordingStartedAtRef.current = Date.now();
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    setIsRecording(false);

    if (recordingSamples.length === 0) {
      recordingStartedAtRef.current = null;
      return;
    }

    const startedAt =
      recordingStartedAtRef.current ?? recordingSamples[0].timestamp;
    const stoppedAt = Date.now();

    api
      .testRecordingSave({
        session_id: fpSessionIdRef.current,
        started_at: startedAt,
        stopped_at: stoppedAt,
        stats: {
          totalDistance,
          displacement,
          elapsedSeconds,
          sampleCount: recordingSamples.length,
        },
        samples: recordingSamples,
      })
      .then((result) => {
        setLastSavedRecording(result.filename);
        setLiveStatusMessage(`Recording saved as ${result.filename}.`);
      })
      .catch((error: any) => {
        setLastSavedRecording(null);
        setLiveStatusMessage(
          `Recording save failed: ${error?.message ?? error}`,
        );
      });

    recordingStartedAtRef.current = null;
  };

  const handleClearRecording = () => {
    setIsRecording(false);
    setRecordingSamples([]);
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

        <View pointerEvents="box-none" style={styles.recordingOverlay}>
          <View style={styles.recordingPanel}>
            <View style={styles.recordingHeaderRow}>
              <Text style={styles.recordingTitle}>Position Recording</Text>
              <View
                style={[
                  styles.recordingBadge,
                  isRecording ? styles.recordingBadgeActive : null,
                ]}>
                <Text
                  style={[
                    styles.recordingBadgeText,
                    isRecording ? styles.recordingBadgeTextActive : null,
                  ]}>
                  {isRecording ? 'REC' : 'IDLE'}
                </Text>
              </View>
            </View>

            <View style={styles.recordingStatsGrid}>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Current (m)</Text>
                <Text style={styles.recordingStatValue}>
                  {latestSample
                    ? `${latestSample.meters.x.toFixed(2)}, ${latestSample.meters.y.toFixed(2)}`
                    : '-'}
                </Text>
              </View>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Start (m)</Text>
                <Text style={styles.recordingStatValue}>
                  {startSample
                    ? `${startSample.meters.x.toFixed(2)}, ${startSample.meters.y.toFixed(2)}`
                    : '-'}
                </Text>
              </View>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Walked</Text>
                <Text style={styles.recordingStatValue}>
                  {totalDistance.toFixed(2)} m
                </Text>
              </View>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Displacement</Text>
                <Text style={styles.recordingStatValue}>
                  {displacement.toFixed(2)} m
                </Text>
              </View>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Elapsed</Text>
                <Text style={styles.recordingStatValue}>
                  {elapsedSeconds.toFixed(1)} s
                </Text>
              </View>
              <View style={styles.recordingStatCell}>
                <Text style={styles.recordingStatLabel}>Samples</Text>
                <Text style={styles.recordingStatValue}>
                  {recordingSamples.length}
                </Text>
              </View>
            </View>

            <View style={styles.recordingButtonRow}>
              <Pressable
                accessibilityRole="button"
                onPress={handleStartRecording}
                disabled={isRecording}
                style={[
                  styles.recordingButton,
                  styles.recordingStartButton,
                  isRecording ? styles.recordingButtonDisabled : null,
                ]}>
                <Text
                  style={[
                    styles.recordingButtonText,
                    styles.recordingStartButtonText,
                    isRecording ? styles.recordingButtonTextDisabled : null,
                  ]}>
                  Start
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleStopRecording}
                disabled={!isRecording}
                style={[
                  styles.recordingButton,
                  styles.recordingStopButton,
                  !isRecording ? styles.recordingButtonDisabled : null,
                ]}>
                <Text
                  style={[
                    styles.recordingButtonText,
                    styles.recordingStopButtonText,
                    !isRecording ? styles.recordingButtonTextDisabled : null,
                  ]}>
                  Stop
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleClearRecording}
                disabled={recordingSamples.length === 0 && !isRecording}
                style={[
                  styles.recordingButton,
                  styles.recordingClearButton,
                  recordingSamples.length === 0 && !isRecording
                    ? styles.recordingButtonDisabled
                    : null,
                ]}>
                <Text
                  style={[
                    styles.recordingButtonText,
                    styles.recordingClearButtonText,
                    recordingSamples.length === 0 && !isRecording
                      ? styles.recordingButtonTextDisabled
                      : null,
                  ]}>
                  Clear
                </Text>
              </Pressable>
            </View>

            {lastSavedRecording ? (
              <Text style={styles.recordingSavedText} numberOfLines={1}>
                Saved: {lastSavedRecording}
              </Text>
            ) : null}
          </View>
        </View>
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
  recordingOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 144,
  },
  recordingPanel: {
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
    ...shadows,
  },
  recordingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordingTitle: {
    color: colors.textPrimary,
    fontSize: typography.section,
    fontWeight: '800',
  },
  recordingBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingBadgeActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  recordingBadgeText: {
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  recordingBadgeTextActive: {
    color: colors.surface,
  },
  recordingStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  recordingStatCell: {
    width: '33.33%',
    paddingVertical: 4,
    paddingRight: spacing.xs,
  },
  recordingStatLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  recordingStatValue: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '800',
    marginTop: 1,
  },
  recordingButtonRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  recordingButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  recordingStartButton: {
    backgroundColor: colors.accent,
  },
  recordingStartButtonText: {
    color: colors.surface,
  },
  recordingStopButton: {
    backgroundColor: colors.danger,
  },
  recordingStopButtonText: {
    color: colors.surface,
  },
  recordingClearButton: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingClearButtonText: {
    color: colors.textSecondary,
  },
  recordingButtonText: {
    fontSize: typography.body,
    fontWeight: '900',
  },
  recordingButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingButtonTextDisabled: {
    color: colors.textMuted,
  },
  recordingSavedText: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    fontWeight: '600',
  },
});
