import type { Arena } from '../types';
import { compassDegToHeading } from '../utils/units';
import { block, roomWalls, wall, zone } from './helpers';

const WIDTH = 320;
const HEIGHT = 220;

/**
 * Playground 2 - Obstacle Course.
 * Wide corridors and free-standing boxes: enough clutter that a robot driving
 * blind crashes within a couple of seconds, but open enough that a simple
 * "if the way is blocked, back up and turn" program survives indefinitely.
 */
export const obstacleCourse: Arena = {
  id: 'obstacles',
  name: 'Obstacle Course',
  description:
    'Boxes and short walls to drive around. Use the ultrasonic sensor with if / else to avoid crashing.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 20,
  start: { x: 40, y: 110, heading: compassDegToHeading(90) },
  obstacles: [
    ...roomWalls(WIDTH, HEIGHT),
    // Two staggered walls forming a slalom.
    wall(110, 4, 8, 80),
    wall(190, 136, 8, 80),
    // Free-standing boxes.
    block(70, 160, 26, 26),
    block(150, 96, 30, 30),
    block(240, 40, 34, 26),
    block(252, 150, 26, 40),
    block(196, 24, 24, 24),
  ],
  lines: [],
  zones: [zone(24, 92, 36, 36, '#9aa7bd', 'Start')],
};
