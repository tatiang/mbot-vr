import type { Arena, RobotPose, Vec2 } from '../types';
import { ROBOT } from './constants';
import { circleIntersectsRect } from './Collision';

/** How far the opponent should land from the player's start, at minimum. */
const MIN_DISTANCE_FROM_START_CM = 45;

/**
 * Chooses a reasonable spot for a stationary practice opponent.
 *
 * The heuristic is deliberately simple: try a handful of candidate points
 * spread around the arena, keep the first one that is inside the walls, clear
 * of every obstacle, and not right on top of the player's start, and fall
 * back to the arena centre if every candidate is blocked (a small or crowded
 * arena, for instance). This does not need to be optimal - the student can
 * always drag the result afterwards - it only needs to not land inside a wall.
 */
export function pickDefaultOpponentSpot(arena: Arena): RobotPose {
  const radius = ROBOT.radiusCm;
  const margin = radius + 4;
  const start: Vec2 = arena.start;

  const candidates: Vec2[] = [
    { x: arena.widthCm * 0.72, y: arena.heightCm * 0.28 },
    { x: arena.widthCm * 0.28, y: arena.heightCm * 0.72 },
    { x: arena.widthCm * 0.72, y: arena.heightCm * 0.72 },
    { x: arena.widthCm * 0.28, y: arena.heightCm * 0.28 },
    { x: arena.widthCm * 0.5, y: arena.heightCm * 0.5 },
  ];

  const clear = (p: Vec2): boolean => {
    if (p.x < margin || p.y < margin) return false;
    if (p.x > arena.widthCm - margin || p.y > arena.heightCm - margin) return false;
    if (Math.hypot(p.x - start.x, p.y - start.y) < MIN_DISTANCE_FROM_START_CM) return false;
    return !arena.obstacles.some((o) => circleIntersectsRect(p, radius, o));
  };

  const chosen = candidates.find(clear) ?? { x: arena.widthCm / 2, y: arena.heightCm / 2 };

  // Face it towards the player's start, so it reads as "watching" rather than
  // pointing at a wall.
  const heading = Math.atan2(start.y - chosen.y, start.x - chosen.x);

  return { x: chosen.x, y: chosen.y, heading };
}
