import {ImageSourcePropType} from 'react-native';

declare const require: (path: string) => ImageSourcePropType;

export type BoelterFloor = '5F' | '8F';

export type BoelterPlaceCategory =
  | 'Room'
  | 'Library'
  | 'Elevator'
  | 'Stairwell'
  | 'Amenity';

export interface BoelterPlace {
  id: string;
  name: string;
  floor: BoelterFloor;
  category: BoelterPlaceCategory;
  subtitle: string;
}

export interface BoelterFloorMap {
  floor: BoelterFloor;
  label: string;
  image: ImageSourcePropType;
  aspectRatio: number;
}

export const BOELTER_FLOOR_MAPS: Record<BoelterFloor, BoelterFloorMap> = {
  '5F': {
    floor: '5F',
    label: 'Boelter 5F',
    image: require('../assets/maps/boelter-5f.png'),
    aspectRatio: 880 / 1080,
  },
  '8F': {
    floor: '8F',
    label: 'Boelter 8F',
    image: require('../assets/maps/boelter-8f.png'),
    aspectRatio: 880 / 1080,
  },
};

export const BOELTER_PLACES: BoelterPlace[] = [
  {
    id: 'boelter-5249',
    name: '5249',
    floor: '5F',
    category: 'Room',
    subtitle: '5F room near the northeast elevator corridor',
  },
  {
    id: 'boelter-5f-elev-2',
    name: 'Elevator 2',
    floor: '5F',
    category: 'Elevator',
    subtitle: '5F northeast vertical transition',
  },
  {
    id: 'boelter-5f-stairs-2',
    name: 'Stairs 2',
    floor: '5F',
    category: 'Stairwell',
    subtitle: '5F stairwell near 5506 and 5271',
  },
  {
    id: 'boelter-5f-stairs-3',
    name: 'Stairs 3',
    floor: '5F',
    category: 'Stairwell',
    subtitle: '5F southeast stairwell near 5705',
  },
  {
    id: 'engineering-library',
    name: 'Engineering Library',
    floor: '8F',
    category: 'Library',
    subtitle: '8F Engineering Library and stack area',
  },
  {
    id: 'boelter-8f-elev-2',
    name: 'Elevator 2',
    floor: '8F',
    category: 'Elevator',
    subtitle: '8F elevator near 8251',
  },
  {
    id: 'boelter-8f-stairs-2',
    name: 'Stairs 2',
    floor: '8F',
    category: 'Stairwell',
    subtitle: '8F stairwell by the Engineering Library entrance',
  },
  {
    id: 'boelter-8f-stacks',
    name: 'Engineering Library Stack',
    floor: '8F',
    category: 'Library',
    subtitle: 'Long stack area beside the main library room',
  },
];
