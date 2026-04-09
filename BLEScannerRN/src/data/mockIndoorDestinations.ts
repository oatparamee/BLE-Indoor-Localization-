export interface MapPoint {
  x: number;
  y: number;
}

export interface PrototypeMapZone {
  id: string;
  name: string;
  subtitle: string;
  defaultFloor: 'L1' | 'L2' | 'L3';
}

export interface IndoorDestination {
  id: string;
  mapId: string;
  name: string;
  subtitle: string;
  floor: 'L1' | 'L2' | 'L3';
  category: 'Study' | 'Lab' | 'Food' | 'Amenity' | 'Support';
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
  floor: 'L1' | 'L2' | 'L3';
  point: MapPoint;
}

export interface FloorRoom {
  id: string;
  label: string;
  left: string;
  top: string;
  width: string;
  height: string;
  tone?: 'primary' | 'secondary' | 'accent';
}

export const prototypeMaps: PrototypeMapZone[] = [
  {
    id: 'engineering-hall',
    name: 'Engineering Core',
    subtitle: 'Demo map zone for labs, lounge seating, and elevator access',
    defaultFloor: 'L2',
  },
  {
    id: 'student-commons',
    name: 'Commons Lobby',
    subtitle: 'Demo map zone for cafe service, lobby seating, and info desk',
    defaultFloor: 'L1',
  },
  {
    id: 'south-atrium',
    name: 'Atrium East Wing',
    subtitle: 'Demo map zone for classrooms, advising, and atrium circulation',
    defaultFloor: 'L1',
  },
];

export const indoorDestinations: IndoorDestination[] = [
  {
    id: 'study-lounge',
    mapId: 'engineering-hall',
    name: 'Study Lounge',
    subtitle: 'Group seating with charging tables',
    floor: 'L2',
    category: 'Study',
    etaMinutes: 2,
    distanceMeters: 78,
    quickAccess: true,
    mapPoint: { x: 24, y: 22 },
    routeSteps: [
      'Continue through the main corridor.',
      'Pass the elevator core and turn left.',
      'The lounge opens on the north side of the hall.',
    ],
  },
  {
    id: 'ece-lab-214',
    mapId: 'engineering-hall',
    name: 'ECE Lab 214',
    subtitle: 'Embedded systems lab and project benches',
    floor: 'L2',
    category: 'Lab',
    etaMinutes: 4,
    distanceMeters: 142,
    quickAccess: true,
    mapPoint: { x: 76, y: 26 },
    routeSteps: [
      'Walk east along the central corridor.',
      'Continue past the lounge until the second junction.',
      'Lab 214 is on the right-hand side.',
    ],
  },
  {
    id: 'campus-cafe',
    mapId: 'student-commons',
    name: 'Campus Cafe',
    subtitle: 'Coffee, snacks, and pickup counter',
    floor: 'L1',
    category: 'Food',
    etaMinutes: 3,
    distanceMeters: 115,
    quickAccess: true,
    mapPoint: { x: 72, y: 70 },
    routeSteps: [
      'Head toward the elevator core.',
      'Take the stairs or elevator down to Level 1.',
      'The cafe sits beside the south lobby.',
    ],
  },
  {
    id: 'east-restrooms',
    mapId: 'student-commons',
    name: 'East Restrooms',
    subtitle: 'Accessible restrooms near the atrium wing',
    floor: 'L2',
    category: 'Amenity',
    etaMinutes: 2,
    distanceMeters: 64,
    quickAccess: true,
    mapPoint: { x: 79, y: 56 },
    routeSteps: [
      'Proceed down the east corridor.',
      'Follow signs past Lab 214.',
      'Restrooms are immediately ahead.',
    ],
  },
  {
    id: 'elevator-core',
    mapId: 'engineering-hall',
    name: 'Elevator Core',
    subtitle: 'Main vertical circulation and accessible route',
    floor: 'L2',
    category: 'Amenity',
    etaMinutes: 1,
    distanceMeters: 28,
    mapPoint: { x: 51, y: 58 },
    routeSteps: [
      'Continue to the center of the corridor.',
      'Elevators will be directly in front of you.',
    ],
  },
  {
    id: 'makerspace',
    mapId: 'engineering-hall',
    name: 'Makerspace',
    subtitle: 'Fabrication equipment and TA support desk',
    floor: 'L3',
    category: 'Support',
    etaMinutes: 5,
    distanceMeters: 180,
    mapPoint: { x: 21, y: 72 },
    routeSteps: [
      'Move to the elevator core.',
      'Take the elevator to Level 3.',
      'Exit left and follow the west hall to the makerspace.',
    ],
  },
  {
    id: 'info-desk',
    mapId: 'student-commons',
    name: 'Info Desk',
    subtitle: 'Front desk for events and student support',
    floor: 'L1',
    category: 'Support',
    etaMinutes: 2,
    distanceMeters: 48,
    mapPoint: { x: 24, y: 74 },
    routeSteps: [
      'Head into the south lobby.',
      'Keep left past the seating area.',
      'The information desk is directly ahead.',
    ],
  },
  {
    id: 'atrium-lecture-102',
    mapId: 'south-atrium',
    name: 'Lecture Hall 102',
    subtitle: 'Large classroom beside the atrium entry',
    floor: 'L1',
    category: 'Support',
    etaMinutes: 3,
    distanceMeters: 96,
    mapPoint: { x: 72, y: 22 },
    routeSteps: [
      'Continue through the atrium corridor.',
      'Pass the help desk and keep right.',
      'Lecture Hall 102 is on the east side.',
    ],
  },
  {
    id: 'advising-office',
    mapId: 'south-atrium',
    name: 'Advising Office',
    subtitle: 'Student services and appointment check-in',
    floor: 'L1',
    category: 'Amenity',
    etaMinutes: 2,
    distanceMeters: 58,
    mapPoint: { x: 22, y: 24 },
    routeSteps: [
      'Walk toward the front desk area.',
      'Turn left at the first junction.',
      'The advising office is beside the atrium seating zone.',
    ],
  },
];

export const favoritePlaces: SavedPlace[] = [
  {
    id: 'favorite-1',
    destinationId: 'ece-lab-214',
    note: 'Project team check-in',
  },
  {
    id: 'favorite-2',
    destinationId: 'campus-cafe',
    note: 'Quick coffee stop before class',
  },
];

export const recentPlaces: SavedPlace[] = [
  {
    id: 'recent-1',
    destinationId: 'study-lounge',
    note: 'Last visited 20 minutes ago',
  },
  {
    id: 'recent-2',
    destinationId: 'east-restrooms',
    note: 'Last visited yesterday',
  },
  {
    id: 'recent-3',
    destinationId: 'elevator-core',
    note: 'Frequently used transfer point',
  },
];

export const beaconAnchors: Record<string, CurrentAnchor> = {
  'beacon-lobby-north': {
    label: 'North Lobby',
    subtitle: 'Near the main entrance',
    floor: 'L2',
    point: { x: 18, y: 78 },
  },
  'beacon-elevator-core': {
    label: 'Elevator Core',
    subtitle: 'Central circulation hub',
    floor: 'L2',
    point: { x: 49, y: 62 },
  },
  'esp32-west-hall': {
    label: 'West Hall',
    subtitle: 'Approaching the study zone',
    floor: 'L2',
    point: { x: 20, y: 46 },
  },
  'beacon-stairwell': {
    label: 'South Stairwell',
    subtitle: 'Close to the south corridor',
    floor: 'L2',
    point: { x: 72, y: 82 },
  },
  'beacon-studio-threshold': {
    label: 'Studio Threshold',
    subtitle: 'Near the east wing transition',
    floor: 'L2',
    point: { x: 78, y: 56 },
  },
};

export const fallbackAnchor: CurrentAnchor = {
  label: 'Main Entrance',
  subtitle: 'Waiting for the strongest BLE signal',
  floor: 'L2',
  point: { x: 18, y: 78 },
};

export const floorLayouts: Record<'L1' | 'L2' | 'L3', FloorRoom[]> = {
  L1: [
    {
      id: 'l1-lobby',
      label: 'South Lobby',
      left: '8%',
      top: '64%',
      width: '28%',
      height: '22%',
      tone: 'accent',
    },
    {
      id: 'l1-cafe',
      label: 'Campus Cafe',
      left: '62%',
      top: '62%',
      width: '24%',
      height: '24%',
      tone: 'primary',
    },
    {
      id: 'l1-help',
      label: 'Help Desk',
      left: '16%',
      top: '18%',
      width: '22%',
      height: '18%',
      tone: 'secondary',
    },
    {
      id: 'l1-mail',
      label: 'Mail Room',
      left: '62%',
      top: '18%',
      width: '18%',
      height: '18%',
      tone: 'secondary',
    },
  ],
  L2: [
    {
      id: 'l2-study',
      label: 'Study Lounge',
      left: '10%',
      top: '12%',
      width: '26%',
      height: '18%',
      tone: 'accent',
    },
    {
      id: 'l2-lab',
      label: 'ECE Lab 214',
      left: '62%',
      top: '14%',
      width: '24%',
      height: '18%',
      tone: 'primary',
    },
    {
      id: 'l2-restroom',
      label: 'Restrooms',
      left: '68%',
      top: '46%',
      width: '18%',
      height: '16%',
      tone: 'secondary',
    },
    {
      id: 'l2-lobby',
      label: 'North Lobby',
      left: '8%',
      top: '66%',
      width: '28%',
      height: '18%',
      tone: 'secondary',
    },
  ],
  L3: [
    {
      id: 'l3-maker',
      label: 'Makerspace',
      left: '10%',
      top: '58%',
      width: '28%',
      height: '22%',
      tone: 'primary',
    },
    {
      id: 'l3-ta',
      label: 'TA Desk',
      left: '14%',
      top: '18%',
      width: '20%',
      height: '16%',
      tone: 'accent',
    },
    {
      id: 'l3-studio',
      label: 'Studio Bay',
      left: '60%',
      top: '18%',
      width: '24%',
      height: '18%',
      tone: 'secondary',
    },
    {
      id: 'l3-storage',
      label: 'Storage',
      left: '64%',
      top: '60%',
      width: '18%',
      height: '14%',
      tone: 'secondary',
    },
  ],
};
