import type { Arena } from '../types';
import { compassDegToHeading } from '../utils/units';
import { roomWalls, zone } from './helpers';

const WIDTH = 300;
const HEIGHT = 240;

/**
 * Experimental Battle Bot Arena.
 *
 * A sumo-style ring with a second, scripted robot. This exists mainly to prove
 * the engine supports more than one robot: the opponent is data-driven
 * (`Arena.opponent`) and the physics already resolves robot-to-robot contact,
 * so a future release can add wedges, scoring and a second block workspace
 * without reworking the simulation.
 */
export const battleArena: Arena = {
  id: 'battle',
  name: 'Battle Bot Arena (experimental)',
  description:
    'A sumo ring with a second robot that chases you. Sense it with the ultrasonic sensor and push it out of the middle.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 0,
  floorColor: '#eef1f7',
  start: { x: 80, y: 190, heading: compassDegToHeading(0) },
  obstacles: roomWalls(WIDTH, HEIGHT, 6),
  lines: [],
  zones: [zone(50, 50, 200, 140, '#e6b8c8', 'Ring')],
  opponent: {
    start: { x: 220, y: 60, heading: compassDegToHeading(180) },
    behavior: 'seek',
    power: 110,
  },
};
