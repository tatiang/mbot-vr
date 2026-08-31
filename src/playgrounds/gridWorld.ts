import type { Arena } from '../types';
import { compassDegToHeading } from '../utils/units';
import { roomWalls, zone } from './helpers';

const WIDTH = 320;
const HEIGHT = 220;

/**
 * Playground 1 - Grid World.
 * An open, obstacle-free room for sequencing, turns and repeat loops. The
 * 20 cm grid gives students a ruler for "how far did it actually go?".
 */
export const gridWorld: Arena = {
  id: 'grid',
  name: 'Grid World',
  description:
    'An open room with a 20 cm grid. Practise driving straight, turning and repeating steps.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 20,
  start: { x: 60, y: 170, heading: compassDegToHeading(0) },
  obstacles: roomWalls(WIDTH, HEIGHT),
  lines: [],
  zones: [
    zone(40, 150, 40, 40, '#9aa7bd', 'Start'),
    zone(140, 150, 40, 40, '#4c8ef7', 'Blue', true),
    zone(240, 60, 40, 40, '#2fb774', 'Green', true),
    zone(140, 40, 40, 40, '#f2a33c', 'Orange', true),
  ],
};
