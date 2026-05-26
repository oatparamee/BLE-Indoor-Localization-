export type FloorCode = '6F' | '8F';

export interface MapPoint {
  x: number;
  y: number;
}

export interface PrototypeMapZone {
  id: string;
  name: string;
  subtitle: string;
  defaultFloor: FloorCode;
}

export interface IndoorDestination {
  id: string;
  mapId: string;
  name: string;
  subtitle: string;
  floor: FloorCode;
  category: 'Room' | 'Library' | 'Elevator' | 'Stairwell' | 'Amenity';
  etaMinutes: number;
  distanceMeters: number;
  quickAccess?: boolean;
  mapPoint: MapPoint;
  routeSteps: string[];
}

export interface SavedPlace {
  id: string;
  destinationId: string;
  note: string;
}

export interface CurrentAnchor {
  label: string;
  subtitle: string;
  floor: FloorCode;
  point: MapPoint;
}

export interface NavigationBeaconMarker {
  id: string;
  label: string;
  floor: FloorCode;
  point: MapPoint;
}

export const prototypeMaps: PrototypeMapZone[] = [
  {
    id: 'boelter-6f-8f-demo',
    name: 'Boelter 6F to 8F',
    subtitle: 'Created floor maps for room, elevator, stairwell, and library testing',
    defaultFloor: '6F',
  },
];

type DestinationCategory = IndoorDestination['category'];

interface DestinationOptions {
  id?: string;
  subtitle?: string;
  quickAccess?: boolean;
}

const demoMapId = 'boelter-6f-8f-demo';

const point = (x: number, y: number): MapPoint => ({ x, y });

const slugifyDestination = (floor: FloorCode, name: string) =>
  `${floor.toLowerCase()}-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

const createDestination = (
  name: string,
  floor: FloorCode,
  category: DestinationCategory,
  mapPoint: MapPoint,
  options: DestinationOptions = {}
): IndoorDestination => ({
  id: options.id ?? slugifyDestination(floor, name),
  mapId: demoMapId,
  name,
  subtitle: options.subtitle ?? `${floor} ${category.toLowerCase()}`,
  floor,
  category,
  etaMinutes: 0,
  distanceMeters: 0,
  quickAccess: options.quickAccess,
  mapPoint,
  routeSteps: ['Route path pending.'],
});

const room = (
  name: string,
  floor: FloorCode,
  mapPoint: MapPoint,
  options?: DestinationOptions
) => createDestination(name, floor, 'Room', mapPoint, options);

const library = (
  name: string,
  floor: FloorCode,
  mapPoint: MapPoint,
  options?: DestinationOptions
) => createDestination(name, floor, 'Library', mapPoint, options);

const amenity = (
  name: string,
  floor: FloorCode,
  mapPoint: MapPoint,
  options?: DestinationOptions
) => createDestination(name, floor, 'Amenity', mapPoint, options);

const elevator = (
  name: string,
  floor: FloorCode,
  mapPoint: MapPoint,
  options?: DestinationOptions
) => createDestination(name, floor, 'Elevator', mapPoint, options);

const stairwell = (
  name: string,
  floor: FloorCode,
  mapPoint: MapPoint,
  options?: DestinationOptions
) => createDestination(name, floor, 'Stairwell', mapPoint, options);

export const indoorDestinations: IndoorDestination[] = [
  room('6631', '6F', point(8, 15)),
  room('6564', '6F', point(9, 30)),
  room('6673', '6F', point(8, 40)),
  room('6672', '6F', point(22, 40)),
  room('6679', '6F', point(5, 49)),
  room('6689', '6F', point(5, 58)),
  room('6805', '6F', point(5, 67)),
  room('6807', '6F', point(5, 76)),
  room('6815', '6F', point(6, 84)),
  room('6763 Suite', '6F', point(8, 91), {
    subtitle: '6F suite along the southwest corridor',
  }),
  room('6817', '6F', point(8, 97)),
  room('6818', '6F', point(22, 88)),
  room('6557', '6F', point(20, 13)),
  room('6549', '6F', point(28, 13)),
  room('6541', '6F', point(48, 13), {
    subtitle: '6F room along the north corridor',
  }),
  room('6535', '6F', point(58, 13)),
  room('6531', '6F', point(64, 13)),
  room('6513', '6F', point(70, 13)),
  room('6505', '6F', point(78, 13)),
  room('6266 Suite', '6F', point(90, 20), {
    id: 'boelter-6266-suite',
    subtitle: '6F suite beside the northeast elevator corridor',
    quickAccess: true,
  }),
  room('6532 Suite', '6F', point(47, 25), {
    subtitle: '6F suite along the inner north corridor',
  }),
  room('6514', '6F', point(68, 25)),
  room('6506', '6F', point(74, 25)),
  room('6270', '6F', point(90, 39)),
  room('6288 Suite', '6F', point(90, 58), {
    subtitle: '6F suite along the east corridor',
  }),
  room('6408', '6F', point(86, 66)),
  room('6412 Suite', '6F', point(90, 71), {
    subtitle: '6F suite along the southeast corridor',
  }),
  room('6678', '6F', point(22, 53)),
  room('6802', '6F', point(22, 64)),
  room('6820', '6F', point(22, 75)),
  room('6271', '6F', point(77, 34)),
  room('6275', '6F', point(76, 38)),
  room('6279', '6F', point(76, 43)),
  room('6291 Suite', '6F', point(76, 58), {
    subtitle: '6F suite along the east interior corridor',
  }),
  room('6415', '6F', point(78, 74)),
  room('6417', '6F', point(76, 80)),
  room('6421', '6F', point(77, 84)),
  room('6731 Suite', '6F', point(48, 92), {
    subtitle: '6F suite along the south inner corridor',
  }),
  room('6713', '6F', point(68, 92)),
  room('6729', '6F', point(49, 92)),
  room('6723', '6F', point(55, 92)),
  room('6707', '6F', point(76, 92)),
  room('6426 Suite', '6F', point(90, 89), {
    subtitle: '6F suite along the lower east corridor',
  }),
  room('6764', '6F', point(16, 96)),
  room('6756', '6F', point(24, 96)),
  room('6750', '6F', point(29, 96)),
  room('6730 Suite', '6F', point(48, 96), {
    subtitle: '6F suite along the lower south corridor',
  }),
  room('6726', '6F', point(62, 96)),
  room('6722', '6F', point(69, 96)),
  room('6714', '6F', point(68, 96)),
  room('6704 Suite', '6F', point(78, 96)),
  room('6440', '6F', point(89, 96)),
  amenity('6F Women\'s Restroom 1', '6F', point(20, 10), {
    subtitle: 'Women\'s restroom near room 6557',
  }),
  amenity('6F Men\'s Restroom', '6F', point(76, 32), {
    subtitle: 'Men\'s restroom beside Stairs 2 and room 6271',
  }),
  amenity('6F Women\'s Restroom 3', '6F', point(78, 86), {
    subtitle: 'Women\'s restroom near Stairs 3',
  }),
  amenity('6F Restroom 4', '6F', point(24, 96), {
    subtitle: 'Restroom near room 6756',
  }),
  elevator('6F Elevator 1', '6F', point(18, 23), {
    subtitle: 'Elevator beside Stairs 1',
  }),
  stairwell('6F Stairs 1', '6F', point(22, 25), {
    subtitle: 'Stairwell by rooms 6564 and 6672',
  }),
  elevator('6F Elevator 2', '6F', point(77, 24), {
    id: '6f-elevator-2',
    subtitle: 'Elevator at the 6F northeast vertical shaft',
    quickAccess: true,
  }),
  stairwell('6F Stairs 2', '6F', point(76, 27), {
    id: '6f-stairs-2',
    subtitle: 'Stairwell near rooms 6506 and 6271',
    quickAccess: true,
  }),
  stairwell('6F Stairs 3', '6F', point(76, 91), {
    subtitle: 'Stairwell near rooms 6713 and 6421',
  }),
  elevator('6F Elevator 3', '6F', point(78, 92), {
    id: '6f-elevator-3',
    subtitle: 'Elevator beside Stairs 3',
  }),
  elevator('6F Elevator 4', '6F', point(18, 88), {
    id: '6f-elevator-4',
    subtitle: 'Elevator beside Stairs 4',
  }),
  stairwell('6F Stairs 4', '6F', point(23, 96), {
    subtitle: 'Stairwell near room 6818',
  }),
  room('8500', '8F', point(47, 31)),
  room('8251', '8F', point(70, 31), {
    subtitle: '8F room beside Elevator 2 and Stairs 2',
  }),
  room('8270XYZ', '8F', point(76, 40), {
    subtitle: '8F vertical room group by the library edge',
  }),
  room('8624B', '8F', point(29, 52)),
  room('8761', '8F', point(28, 80)),
  room('8427', '8F', point(67, 70)),
  room('8270', '8F', point(70, 68), {
    subtitle: '8F small room by 8427',
  }),
  room('8270J', '8F', point(77, 68), {
    subtitle: '8F small room on the east library edge',
  }),
  room('8270H', '8F', point(77, 73), {
    subtitle: '8F small room on the east library edge',
  }),
  room('8438', '8F', point(68, 82)),
  room('8436', '8F', point(79, 82)),
  library('Engineering Library Stack', '8F', point(66, 53), {
    subtitle: '8F Engineering Library stack area',
    quickAccess: true,
  }),
  library('Engineering Library', '8F', point(77, 53), {
    id: 'engineering-library',
    subtitle: '8F Engineering Library reading area',
    quickAccess: true,
  }),
  amenity('8F Restroom', '8F', point(29, 36), {
    subtitle: 'Restroom beside Elevator 1 and Stairs 1',
  }),
  elevator('8F Elevator 1', '8F', point(31, 34), {
    subtitle: 'Elevator beside Stairs 1',
  }),
  stairwell('8F Stairs 1', '8F', point(34, 35), {
    subtitle: 'Stairwell beside the west restroom',
  }),
  elevator('8F Elevator 2', '8F', point(66, 34), {
    id: '8f-elevator-2',
    subtitle: 'Elevator by 8251 and Stairs 2',
    quickAccess: true,
  }),
  stairwell('8F Stairs 2', '8F', point(67, 36), {
    id: '8f-stairs-2',
    subtitle: 'Stairwell at the top of the Engineering Library area',
    quickAccess: true,
  }),
  stairwell('8F Stairs 3', '8F', point(67, 73), {
    subtitle: 'Stairwell near room 8427',
  }),
  elevator('8F Elevator 3', '8F', point(69, 80), {
    subtitle: 'Elevator beside Stairs 3',
  }),
  elevator('8F Elevator 4', '8F', point(30, 82), {
    subtitle: 'Elevator beside Stairs 4',
  }),
  stairwell('8F Stairs 4', '8F', point(34, 80), {
    subtitle: 'Stairwell near room 8761',
  }),
];

export const favoritePlaces: SavedPlace[] = [
  {
    id: 'favorite-1',
    destinationId: 'engineering-library',
    note: 'Primary demo destination',
  },
  {
    id: 'favorite-2',
    destinationId: 'boelter-6266-suite',
    note: 'Potential 6F start room',
  },
];

export const recentPlaces: SavedPlace[] = [
  {
    id: 'recent-1',
    destinationId: '6f-elevator-2',
    note: 'Vertical transition candidate',
  },
  {
    id: 'recent-2',
    destinationId: '8f-stairs-2',
    note: 'Backup vertical route candidate',
  },
];

export const beaconAnchors: Record<string, CurrentAnchor> = {
  'beacon-lobby-north': {
    label: '6F Northeast Hall',
    subtitle: 'Fallback zone near 6266 Suite and Elevator 2',
    floor: '6F',
    point: { x: 78, y: 32 },
  },
  'beacon-elevator-core': {
    label: '6F Elevator 2',
    subtitle: 'Vertical transition zone',
    floor: '6F',
    point: { x: 77, y: 33 },
  },
  'esp32-west-hall': {
    label: '6F West Hall',
    subtitle: 'Approximate west corridor zone',
    floor: '6F',
    point: { x: 16, y: 44 },
  },
  'beacon-stairwell': {
    label: '8F Stairs 2',
    subtitle: 'Engineering Library stairwell zone',
    floor: '8F',
    point: { x: 67, y: 35 },
  },
  'beacon-studio-threshold': {
    label: '8F Engineering Library',
    subtitle: 'Library stack zone',
    floor: '8F',
    point: { x: 74, y: 47 },
  },
};

export const fallbackAnchor: CurrentAnchor = {
  label: '6F Northeast Hall',
  subtitle: 'Waiting for the strongest BLE signal',
  floor: '6F',
  point: { x: 78, y: 32 },
};

const SIX_FLOOR_MAP_SIZE_PX = {width: 880, height: 1080};
const SIX_FLOOR_PIXELS_PER_METER = 802 / 72.2;
const SIX_FLOOR_BCPRO_1_PERCENT = point(21, 12);
const SIX_FLOOR_BEACON_OFFSET_METERS = {x: -4.5, y: 1.5};

const sixFloorNavigationBeaconNames = new Set([
  'BCPro_1',
  'BCPro_3',
  'BCPro_6',
  'BCPro_0',
  'BCPro_7',
  'BCPro_10',
  'BCPro_5',
  'BCPro_9',
  'BCPro_17',
  'BCPro_18',
  'BCPro_67',
  'BCPro_19',
  'BCPro_15',
]);

export interface NavigationBeaconSource {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface AxisAlignedTransform {
  sourceReference: MapPoint;
  mapReferencePx: MapPoint;
}

function percentToMapPx(percentPoint: MapPoint): MapPoint {
  return {
    x: (percentPoint.x / 100) * SIX_FLOOR_MAP_SIZE_PX.width,
    y: (percentPoint.y / 100) * SIX_FLOOR_MAP_SIZE_PX.height,
  };
}

function mapPxToPercent(pixelPoint: MapPoint): MapPoint {
  return {
    x: (pixelPoint.x / SIX_FLOOR_MAP_SIZE_PX.width) * 100,
    y: (pixelPoint.y / SIX_FLOOR_MAP_SIZE_PX.height) * 100,
  };
}

function buildAxisAlignedSixFloorTransform(
  byName: Map<string, NavigationBeaconSource>
): AxisAlignedTransform | null {
  const referenceBeacon = byName.get('BCPro_1');

  if (!referenceBeacon) {
    return null;
  }

  return {
    sourceReference: point(referenceBeacon.x, referenceBeacon.y),
    mapReferencePx: percentToMapPx(SIX_FLOOR_BCPRO_1_PERCENT),
  };
}

function applyAxisAlignedNormalization(
  sourcePoint: MapPoint,
  transform: AxisAlignedTransform
): MapPoint | null {
  const mapPixelPoint = {
    x:
      transform.mapReferencePx.x +
      (sourcePoint.y - transform.sourceReference.y) *
        SIX_FLOOR_PIXELS_PER_METER +
      SIX_FLOOR_BEACON_OFFSET_METERS.x * SIX_FLOOR_PIXELS_PER_METER,
    y:
      transform.mapReferencePx.y +
      (transform.sourceReference.x - sourcePoint.x) *
        SIX_FLOOR_PIXELS_PER_METER +
      SIX_FLOOR_BEACON_OFFSET_METERS.y * SIX_FLOOR_PIXELS_PER_METER,
  };

  return mapPxToPercent(mapPixelPoint);
}

export function buildSixFloorNavigationBeaconMarkers(
  beacons: NavigationBeaconSource[]
): NavigationBeaconMarker[] {
  const sixFloorBeacons = beacons.filter((beacon) =>
    sixFloorNavigationBeaconNames.has(beacon.name)
  );
  const byName = new Map(sixFloorBeacons.map((beacon) => [beacon.name, beacon]));
  const transform = buildAxisAlignedSixFloorTransform(byName);

  if (!transform) {
    return [];
  }

  return sixFloorBeacons
    .map((beacon) => {
      const mapPoint = applyAxisAlignedNormalization(
        point(beacon.x, beacon.y),
        transform
      );

      if (!mapPoint) {
        return null;
      }

      return {
        id: beacon.id,
        label: beacon.name,
        floor: '6F' as const,
        point: mapPoint,
      };
    })
    .filter((marker): marker is NavigationBeaconMarker => marker !== null);
}

export function projectSixFloorMeterPointToMap(
  pointMeters: MapPoint,
  beacons: NavigationBeaconSource[]
): MapPoint | null {
  const sixFloorBeacons = beacons.filter((beacon) =>
    sixFloorNavigationBeaconNames.has(beacon.name)
  );
  const byName = new Map(sixFloorBeacons.map((beacon) => [beacon.name, beacon]));
  const transform = buildAxisAlignedSixFloorTransform(byName);

  if (!transform) {
    return null;
  }

  return applyAxisAlignedNormalization(pointMeters, transform);
}
