export type FloorCode = '5F' | '8F';

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

export const prototypeMaps: PrototypeMapZone[] = [
  {
    id: 'boelter-5f-8f-demo',
    name: 'Boelter 5F to 8F',
    subtitle: 'Created floor maps for room, elevator, stairwell, and library testing',
    defaultFloor: '5F',
  },
];

type DestinationCategory = IndoorDestination['category'];

interface DestinationOptions {
  id?: string;
  subtitle?: string;
  quickAccess?: boolean;
}

const demoMapId = 'boelter-5f-8f-demo';

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
  room('5651', '5F', point(8, 15)),
  room('5667', '5F', point(8, 30)),
  room('5801', '5F', point(8, 47)),
  room('5805', '5F', point(8, 59)),
  room('5818', '5F', point(8, 69)),
  room('5819', '5F', point(8, 79)),
  room('5766', '5F', point(8, 94)),
  room('5764', '5F', point(16, 94)),
  room('5756', '5F', point(23, 92), {
    subtitle: '5F small room by the lower restroom',
  }),
  room('5750', '5F', point(29, 94)),
  room('5549', '5F', point(28, 13)),
  room('5531 Suite', '5F', point(48, 13), {
    subtitle: '5F suite along the north corridor',
  }),
  room('5513', '5F', point(68, 13)),
  room('5249', '5F', point(78, 13), {
    id: 'boelter-5249',
    subtitle: '5F room near the northeast corridor',
    quickAccess: true,
  }),
  room('5252', '5F', point(90, 13)),
  room('5532 Suite', '5F', point(47, 25), {
    subtitle: '5F suite along the inner north corridor',
  }),
  room('5514', '5F', point(68, 25)),
  room('5506', '5F', point(74, 25)),
  room('5264', '5F', point(90, 25)),
  room('5272', '5F', point(90, 33)),
  room('5280', '5F', point(90, 41)),
  room('5284', '5F', point(86, 46)),
  room('5288', '5F', point(86, 50)),
  room('5662', '5F', point(18, 25)),
  room('5664', '5F', point(18, 29)),
  room('5668', '5F', point(22, 35)),
  room('5800', '5F', point(22, 47)),
  room('5802', '5F', point(22, 58)),
  room('5806', '5F', point(22, 66)),
  room('5824', '5F', point(22, 76)),
  room('5832', '5F', point(20, 82)),
  room('5731 Suite', '5F', point(48, 83), {
    subtitle: '5F suite along the south inner corridor',
  }),
  room('5713', '5F', point(68, 83)),
  room('5705', '5F', point(73, 87)),
  room('5436', '5F', point(91, 84)),
  room('5732 Suite', '5F', point(48, 94), {
    subtitle: '5F suite along the lower south corridor',
  }),
  room('5714', '5F', point(68, 94)),
  room('5704', '5F', point(78, 94)),
  room('5440', '5F', point(89, 94)),
  room('5271', '5F', point(77, 34)),
  room('5273', '5F', point(76, 40)),
  room('5289 Suite', '5F', point(76, 48)),
  room('5401', '5F', point(73, 53)),
  room('5403', '5F', point(73, 56)),
  room('5405', '5F', point(74, 60)),
  room('5409', '5F', point(74, 63)),
  room('5419', '5F', point(75, 72)),
  room('5421', '5F', point(77, 76)),
  room('5408', '5F', point(87, 60)),
  room('5412', '5F', point(87, 63)),
  room('5420', '5F', point(89, 72)),
  room('5422', '5F', point(89, 80)),
  amenity('5F Women\'s Restroom 1', '5F', point(20, 11), {
    subtitle: 'Women\'s restroom near room 5549',
  }),
  amenity('5F Restroom near 5271', '5F', point(76, 33), {
    subtitle: 'Restroom beside Stairs 2 and room 5271',
  }),
  amenity('5F Women\'s Restroom 3', '5F', point(78, 77), {
    subtitle: 'Women\'s restroom near Stairs 3',
  }),
  amenity('5F South Restroom', '5F', point(24, 93), {
    subtitle: 'Restroom near room 5756',
  }),
  amenity('SEAS Cafe', '5F', point(28, 55), {
    subtitle: 'Cafe along the 5F west interior corridor',
  }),
  elevator('5F Elevator 1', '5F', point(18, 23), {
    subtitle: 'Elevator beside Stairs 1',
  }),
  stairwell('5F Stairs 1', '5F', point(22, 25), {
    subtitle: 'Stairwell by rooms 5662 and 5664',
  }),
  elevator('5F Elevator 2', '5F', point(77, 24), {
    id: '5f-elevator-2',
    subtitle: 'Elevator at the 5F northeast vertical shaft',
    quickAccess: true,
  }),
  stairwell('5F Stairs 2', '5F', point(76, 27), {
    id: '5f-stairs-2',
    subtitle: 'Stairwell near rooms 5506 and 5271',
    quickAccess: true,
  }),
  stairwell('5F Stairs 3', '5F', point(76, 82), {
    subtitle: 'Stairwell near rooms 5705 and 5713',
  }),
  elevator('5F Elevator 3', '5F', point(78, 86), {
    subtitle: 'Elevator beside Stairs 3',
  }),
  elevator('5F Elevator 4', '5F', point(18, 87), {
    subtitle: 'Elevator beside Stairs 4',
  }),
  stairwell('5F Stairs 4', '5F', point(23, 83), {
    subtitle: 'Stairwell near room 5832',
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
    destinationId: 'boelter-5249',
    note: 'Potential 5F start room',
  },
];

export const recentPlaces: SavedPlace[] = [
  {
    id: 'recent-1',
    destinationId: '5f-elevator-2',
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
    label: '5F Northeast Hall',
    subtitle: 'Fallback zone near 5249 and Elevator 2',
    floor: '5F',
    point: { x: 78, y: 32 },
  },
  'beacon-elevator-core': {
    label: '5F Elevator 2',
    subtitle: 'Vertical transition zone',
    floor: '5F',
    point: { x: 77, y: 33 },
  },
  'esp32-west-hall': {
    label: '5F West Hall',
    subtitle: 'Approximate west corridor zone',
    floor: '5F',
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
  label: '5F Northeast Hall',
  subtitle: 'Waiting for the strongest BLE signal',
  floor: '5F',
  point: { x: 78, y: 32 },
};
