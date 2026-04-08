export interface MockBeaconSeed {
  id: string;
  name: string;
  baseRssi: number;
  sway: number;
  phase: number;
}

export const mockBeaconSeeds: MockBeaconSeed[] = [
  {
    id: 'beacon-lobby-north',
    name: 'North Lobby Beacon',
    baseRssi: -49,
    sway: 4,
    phase: 1,
  },
  {
    id: 'beacon-elevator-core',
    name: 'Elevator Core Marker',
    baseRssi: -58,
    sway: 5,
    phase: 4,
  },
  {
    id: 'esp32-west-hall',
    name: 'West Hall ESP32',
    baseRssi: -65,
    sway: 6,
    phase: 7,
  },
  {
    id: 'beacon-stairwell',
    name: 'Stairwell Relay',
    baseRssi: -73,
    sway: 7,
    phase: 10,
  },
  {
    id: 'beacon-studio-threshold',
    name: 'Studio Threshold',
    baseRssi: -79,
    sway: 6,
    phase: 13,
  },
];

export function getMockRssi(seed: MockBeaconSeed, tick: number): number {
  const slowWave = Math.sin((tick + seed.phase) * 0.7) * seed.sway;
  const fastWave = Math.cos((tick + 2) * (seed.phase + 1) * 0.18) * 1.9;
  const drift = Math.sin((tick + seed.phase) * 0.2) * 1.4;
  return Math.round((seed.baseRssi + slowWave + fastWave + drift) * 10) / 10;
}
