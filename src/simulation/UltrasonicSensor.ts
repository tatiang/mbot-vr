import type { Arena, Vec2 } from '../types';
import { ULTRASONIC } from './constants';
import { degToRad } from '../utils/units';
import { rayCircleIntersection, rayRectIntersection } from '../utils/geometry';

export interface UltrasonicReading {
  /**
   * Distance in centimetres, or `0` when nothing is in range.
   *
   * Returning 0 for "no detection" mirrors the original V-REP script
   * (`ReadUltrasonicSensor` returns 0 when the proximity sensor reports no
   * hit), so programs written here behave the same way on the original stack.
   */
  distanceCm: number;
  /** Per-ray results, used by the sensor overlay to explain the reading. */
  rays: { origin: Vec2; end: Vec2; hit: boolean; distanceCm: number }[];
  /** World position of the closest hit, or null when nothing was detected. */
  hitPoint: Vec2 | null;
}

/**
 * Casts a small fan of rays from the front of the robot and reports the closest
 * hit. A fan rather than a single hairline ray means the sensor sees thin
 * obstacle corners the way a real ultrasonic cone does, and it gives the
 * overlay something meaningful to draw.
 */
export function readUltrasonic(
  origin: Vec2,
  heading: number,
  arena: Arena,
  otherRobots: { center: Vec2; radius: number }[] = [],
): UltrasonicReading {
  const rays: UltrasonicReading['rays'] = [];
  let best = Infinity;
  let hitPoint: Vec2 | null = null;

  const half = degToRad(ULTRASONIC.halfAngleDeg);
  const count = ULTRASONIC.rayCount;

  for (let i = 0; i < count; i += 1) {
    // Spread rays evenly across the cone; with an odd count the middle ray
    // points straight ahead.
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = heading - half + t * half * 2;
    const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };

    let rayDist = ULTRASONIC.maxRangeCm;
    let rayHit = false;

    for (const obstacle of arena.obstacles) {
      const d = rayRectIntersection(origin, dir, obstacle);
      if (d !== null && d < rayDist) {
        rayDist = d;
        rayHit = true;
      }
    }

    for (const robot of otherRobots) {
      const d = rayCircleIntersection(origin, dir, robot.center, robot.radius);
      if (d !== null && d < rayDist) {
        rayDist = d;
        rayHit = true;
      }
    }

    // The arena boundary is solid, so treat it as four walls.
    const wallDist = distanceToArenaBounds(origin, dir, arena);
    if (wallDist !== null && wallDist < rayDist) {
      rayDist = wallDist;
      rayHit = true;
    }

    const end = { x: origin.x + dir.x * rayDist, y: origin.y + dir.y * rayDist };
    rays.push({ origin, end, hit: rayHit, distanceCm: rayDist });

    if (rayHit && rayDist < best) {
      best = rayDist;
      hitPoint = end;
    }
  }

  // Out of range, or closer than the sensor's blind spot: report "nothing there".
  if (!Number.isFinite(best) || best > ULTRASONIC.maxRangeCm) {
    return { distanceCm: 0, rays, hitPoint: null };
  }

  // Below the minimum range a real HC-SR04 cannot resolve an echo; clamp to the
  // minimum rather than reporting 0 so students still see "very close".
  const distanceCm = Math.max(ULTRASONIC.minRangeCm, best);
  return { distanceCm, rays, hitPoint };
}

/** Distance from `origin` along `dir` to the arena boundary. */
function distanceToArenaBounds(origin: Vec2, dir: Vec2, arena: Arena): number | null {
  let best = Infinity;

  const check = (t: number) => {
    if (t > 0 && t < best) best = t;
  };

  if (dir.x > 1e-9) check((arena.widthCm - origin.x) / dir.x);
  if (dir.x < -1e-9) check((0 - origin.x) / dir.x);
  if (dir.y > 1e-9) check((arena.heightCm - origin.y) / dir.y);
  if (dir.y < -1e-9) check((0 - origin.y) / dir.y);

  return Number.isFinite(best) ? best : null;
}
