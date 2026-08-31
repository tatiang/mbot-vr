import type { Arena, Obstacle, RobotPose, Vec2 } from '../types';
import { clampToRect, distance } from '../utils/geometry';

/** Tolerance for "already touching", in centimetres. */
const EPSILON = 1e-6;

export interface CollisionResult {
  pose: RobotPose;
  collided: boolean;
  /** Unit push-out direction, useful for pushing an opponent robot. */
  normal: Vec2 | null;
}

/**
 * Resolves the robot (modelled as a circle) against the arena walls and every
 * rectangular obstacle.
 *
 * Rather than stopping dead, the robot is pushed back out along the shallowest
 * axis. That produces the sliding-along-a-wall behaviour students expect from a
 * real robot bumping a box at an angle, and it can never trap the robot inside
 * geometry.
 */
export function resolveCollisions(
  pose: RobotPose,
  radius: number,
  arena: Arena,
  extraCircles: { center: Vec2; radius: number }[] = [],
): CollisionResult {
  let { x, y } = pose;
  let collided = false;
  let normal: Vec2 | null = null;

  // Arena boundary.
  if (x < radius) {
    x = radius;
    collided = true;
    normal = { x: 1, y: 0 };
  } else if (x > arena.widthCm - radius) {
    x = arena.widthCm - radius;
    collided = true;
    normal = { x: -1, y: 0 };
  }
  if (y < radius) {
    y = radius;
    collided = true;
    normal = { x: 0, y: 1 };
  } else if (y > arena.heightCm - radius) {
    y = arena.heightCm - radius;
    collided = true;
    normal = { x: 0, y: -1 };
  }

  // Rectangular obstacles. Pushing out of one box can shove the robot into its
  // neighbour, so iterate until nothing moves. Inside corners need a few passes
  // to settle; the cap stops a pathological arrangement from spinning forever.
  for (let pass = 0; pass < 6; pass += 1) {
    let movedThisPass = false;
    for (const obstacle of arena.obstacles) {
      const push = pushCircleOutOfRect({ x, y }, radius, obstacle);
      if (!push) continue;
      collided = true;
      // A zero-length push means "touching but not penetrating" - record the
      // contact but do not count it as movement, or the loop never converges.
      if (Math.abs(push.x) > EPSILON || Math.abs(push.y) > EPSILON) {
        x += push.x;
        y += push.y;
        movedThisPass = true;
        normal = normalise(push);
      }
    }
    if (!movedThisPass) break;
  }

  // Other robots (Battle Bot arena).
  for (const circle of extraCircles) {
    const d = distance({ x, y }, circle.center);
    const minDist = radius + circle.radius;
    if (d < minDist && d > 1e-6) {
      const nx = (x - circle.center.x) / d;
      const ny = (y - circle.center.y) / d;
      const overlap = minDist - d;
      x += nx * overlap;
      y += ny * overlap;
      collided = true;
      normal = { x: nx, y: ny };
    }
  }

  return { pose: { x, y, heading: pose.heading }, collided, normal };
}

/**
 * Returns the minimum translation vector that separates a circle from a
 * rectangle, or `null` when they are not overlapping.
 */
export function pushCircleOutOfRect(center: Vec2, radius: number, rect: Obstacle): Vec2 | null {
  const nearest = clampToRect(center, rect);
  const dx = center.x - nearest.x;
  const dy = center.y - nearest.y;
  const distSq = dx * dx + dy * dy;

  // Touching exactly counts as clear: after a push-out the circle sits on the
  // face, and treating that as an overlap would make the resolver oscillate.
  if (distSq >= radius * radius - EPSILON) return null;

  if (distSq > 1e-9) {
    // Centre is outside the rectangle: push straight out along the contact normal.
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    return { x: (dx / dist) * overlap, y: (dy / dist) * overlap };
  }

  // Centre is inside the rectangle: escape via the nearest face.
  const left = center.x - rect.x;
  const right = rect.x + rect.width - center.x;
  const top = center.y - rect.y;
  const bottom = rect.y + rect.height - center.y;
  const min = Math.min(left, right, top, bottom);

  if (min === left) return { x: -(left + radius), y: 0 };
  if (min === right) return { x: right + radius, y: 0 };
  if (min === top) return { x: 0, y: -(top + radius) };
  return { x: 0, y: bottom + radius };
}

export function circleIntersectsRect(center: Vec2, radius: number, rect: Obstacle): boolean {
  return pushCircleOutOfRect(center, radius, rect) !== null;
}

function normalise(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}
