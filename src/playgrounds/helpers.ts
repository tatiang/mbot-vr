import type { Obstacle, Zone, LinePath, Vec2 } from '../types';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

export function wall(x: number, y: number, width: number, height: number): Obstacle {
  return { id: nextId('wall'), kind: 'wall', x, y, width, height };
}

export function block(x: number, y: number, width: number, height: number, color?: string): Obstacle {
  return { id: nextId('block'), kind: 'block', x, y, width, height, ...(color ? { color } : {}) };
}

export function zone(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  label?: string,
  goal = false,
): Zone {
  return { id: nextId('zone'), x, y, width, height, color, goal, ...(label ? { label } : {}) };
}

export function line(points: Vec2[], width = 3.2, closed = false): LinePath {
  return { id: nextId('line'), points, width, closed };
}

/**
 * Builds a rounded rectangle as a polyline - the shape most classroom line
 * courses use, with straights joined by quarter-circle corners.
 */
export function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  segmentsPerCorner = 8,
): Vec2[] {
  const r = Math.min(radius, width / 2, height / 2);
  const pts: Vec2[] = [];
  const corners: { cx: number; cy: number; start: number }[] = [
    { cx: x + width - r, cy: y + r, start: -Math.PI / 2 }, // top-right
    { cx: x + width - r, cy: y + height - r, start: 0 }, // bottom-right
    { cx: x + r, cy: y + height - r, start: Math.PI / 2 }, // bottom-left
    { cx: x + r, cy: y + r, start: Math.PI }, // top-left
  ];

  pts.push({ x: x + r, y });
  pts.push({ x: x + width - r, y });
  for (let c = 0; c < corners.length; c += 1) {
    const corner = corners[c];
    for (let i = 1; i <= segmentsPerCorner; i += 1) {
      const a = corner.start + (i / segmentsPerCorner) * (Math.PI / 2);
      pts.push({ x: corner.cx + Math.cos(a) * r, y: corner.cy + Math.sin(a) * r });
    }
    // Straight run to the start of the next corner is implicit in the polyline.
  }
  return pts;
}

/** Border walls drawn just inside the arena edge, so the room reads as a room. */
export function roomWalls(width: number, height: number, thickness = 4): Obstacle[] {
  return [
    wall(0, 0, width, thickness),
    wall(0, height - thickness, width, thickness),
    wall(0, 0, thickness, height),
    wall(width - thickness, 0, thickness, height),
  ];
}
