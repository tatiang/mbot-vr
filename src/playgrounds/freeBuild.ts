import type { Arena } from '../types';
import { compassDegToHeading } from '../utils/units';
import { roomWalls } from './helpers';

const WIDTH = 320;
const HEIGHT = 220;

/**
 * Playground 5 - Free Build.
 * An empty room the student edits with the arena tools. Marked `editable`, so
 * the UI shows the editor toolbar and the project file carries a copy of the
 * arena alongside the blocks.
 */
export const freeBuild: Arena = {
  id: 'free',
  name: 'Free Build',
  description: 'An empty room. Add walls, boxes and tape, then move the start marker where you like.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 20,
  editable: true,
  start: { x: 60, y: 170, heading: compassDegToHeading(0) },
  obstacles: roomWalls(WIDTH, HEIGHT),
  lines: [],
  zones: [],
};
