/**
 * ==========================================================================
 *   Beacon Selection Store
 * ==========================================================================
 *   Lets the user pick ANY 3 detected BLE beacons (by UUID / device.id)
 *   and assign them the roles of 1st, 2nd, and 3rd beacon for
 *   trilateration, each with its own (x, y) position in meters.
 *
 *   The selection is persisted to AsyncStorage so it survives app
 *   restarts. The default selection on first launch uses the three
 *   names defined in BEACONS (frontend/src/config/beacons.ts), but
 *   the user can override them with any beacons the scanner sees.
 * ==========================================================================
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {BEACONS} from './beacons';

export interface BeaconSlot {
  /** BLE device.id (UUID on iOS, MAC-like string on Android). */
  id: string;
  /** Human-readable name advertised by the beacon. */
  name: string;
  x: number;
  y: number;
}

export type BeaconSelection = (BeaconSlot | null)[];

export const SLOT_COUNT = 3;
const STORAGE_KEY = '@ble_beacon_selection_v1';

function defaultSelection(): BeaconSelection {
  const names = Object.keys(BEACONS);
  const slots: BeaconSelection = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const name = names[i];
    if (name) {
      const pos = BEACONS[name];
      // id defaults to the configured name so legacy setups still work;
      // the user can reassign the slot to a real UUID from the scanner.
      slots.push({id: name, name, x: pos.x, y: pos.y});
    } else {
      slots.push(null);
    }
  }
  return slots;
}

let cached: BeaconSelection = defaultSelection();
let loaded = false;

export async function loadBeaconSelection(): Promise<BeaconSelection> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalised: BeaconSelection = [];
        for (let i = 0; i < SLOT_COUNT; i++) {
          const slot = parsed[i];
          if (
            slot &&
            typeof slot === 'object' &&
            typeof slot.id === 'string' &&
            typeof slot.name === 'string' &&
            typeof slot.x === 'number' &&
            typeof slot.y === 'number'
          ) {
            normalised.push({id: slot.id, name: slot.name, x: slot.x, y: slot.y});
          } else {
            normalised.push(null);
          }
        }
        cached = normalised;
      }
    }
  } catch {
    // Fall back to default selection
  }
  loaded = true;
  return cached;
}

export async function saveBeaconSelection(selection: BeaconSelection): Promise<void> {
  const clean: BeaconSelection = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    clean.push(selection[i] ?? null);
  }
  cached = clean;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
}

export function getBeaconSelection(): BeaconSelection {
  return cached;
}

export function isBeaconSelectionLoaded(): boolean {
  return loaded;
}

/** Returns the subset of slots that are fully defined. */
export function getFilledSlots(selection: BeaconSelection): BeaconSlot[] {
  return selection.filter((s): s is BeaconSlot => s !== null);
}
