import type { Rect, Vec2 } from '../types';

/** Squared distance - avoids a square root in hot collision loops. */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

/** Closest point to `p` on the segment `a`-`b`. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

/** Rotates `point` around the origin by `angle` radians (clockwise on screen). */
export function rotate(point: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

/** Transforms a robot-local offset into world space. */
export function toWorld(origin: Vec2, heading: number, local: Vec2): Vec2 {
  const r = rotate(local, heading);
  return { x: origin.x + r.x, y: origin.y + r.y };
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Clamps a point into a rectangle - the basis of circle/AABB collision. */
export function clampToRect(p: Vec2, r: Rect): Vec2 {
  return {
    x: Math.max(r.x, Math.min(r.x + r.width, p.x)),
    y: Math.max(r.y, Math.min(r.y + r.height, p.y)),
  };
}

/**
 * Ray/AABB intersection using the slab method.
 * Returns the distance along the ray, or `null` when the ray misses.
 * `dir` must be normalised.
 */
export function rayRectIntersection(origin: Vec2, dir: Vec2, rect: Rect): number | null {
  const minX = rect.x;
  const minY = rect.y;
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;

  // Guard against division by zero for axis-aligned rays: an infinite slope
  // simply means the ray never leaves that slab.
  const invX = dir.x !== 0 ? 1 / dir.x : Infinity;
  const invY = dir.y !== 0 ? 1 / dir.y : Infinity;

  let t1 = (minX - origin.x) * invX;
  let t2 = (maxX - origin.x) * invX;
  let tMin = Math.min(t1, t2);
  let tMax = Math.max(t1, t2);

  t1 = (minY - origin.y) * invY;
  t2 = (maxY - origin.y) * invY;
  tMin = Math.max(tMin, Math.min(t1, t2));
  tMax = Math.min(tMax, Math.max(t1, t2));

  if (tMax < 0 || tMin > tMax) return null;
  // Origin inside the box counts as a zero-distance hit.
  return tMin >= 0 ? tMin : 0;
}

/** Distance from a ray origin to a circle, or `null` when it misses. */
export function rayCircleIntersection(
  origin: Vec2,
  dir: Vec2,
  center: Vec2,
  radius: number,
): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const b = ox * dir.x + oy * dir.y;
  const c = ox * ox + oy * oy - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = -b - sqrtDisc;
  const t2 = -b + sqrtDisc;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return 0;
  return null;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}
