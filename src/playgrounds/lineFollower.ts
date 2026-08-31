import type { Arena, Vec2 } from '../types';
import { line, roomWalls } from './helpers';

const WIDTH = 320;
const HEIGHT = 220;
const CENTER: Vec2 = { x: 160, y: 112 };
const RX = 95;
const RY = 62;
const SAMPLES = 180;

/**
 * Radial modulation of the loop.
 *
 * A plain oval would give students one constant-radius turn to tune against.
 * Adding two harmonics produces a course with long gentle sweeps and a couple
 * of genuinely tight corners, so a follower that only ever nudges one wheel
 * falls off and has to be improved.
 */
function radiusFactor(theta: number): number {
  return 1 + 0.16 * Math.sin(2 * theta) + 0.08 * Math.cos(3 * theta);
}

function pointAt(theta: number): Vec2 {
  const f = radiusFactor(theta);
  return {
    x: CENTER.x + RX * f * Math.cos(theta),
    y: CENTER.y + RY * f * Math.sin(theta),
  };
}

function buildCoursePoints(): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    pts.push(pointAt((i / SAMPLES) * Math.PI * 2));
  }
  return pts;
}

const coursePoints = buildCoursePoints();

/** Heading tangent to the course at the start point, so the robot sets off along the tape. */
function startHeading(): number {
  const a = pointAt(0);
  const b = pointAt(0.05);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

const startPoint = pointAt(0);

/**
 * Playground 3 - Line Follower.
 * A single closed loop of wide black tape with straights, gentle curves and
 * sharp corners. The bundled starter program completes a lap.
 */
export const lineFollowerCourse: Arena = {
  id: 'line',
  name: 'Line Follower',
  description:
    'A closed loop of black tape with easy and hard corners. Use the two line sensors to stay on it.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 0,
  floorColor: '#f4f6fb',
  start: { x: startPoint.x, y: startPoint.y, heading: startHeading() },
  obstacles: roomWalls(WIDTH, HEIGHT),
  lines: [line(coursePoints, 4, true)],
  zones: [],
};
