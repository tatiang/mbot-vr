import { describe, expect, it } from 'vitest';
import type { Arena, Vec2 } from '../src/types';
import { maze, MAZE_CELL_CENTERS } from '../src/playgrounds/maze';
import { obstacleCourse } from '../src/playgrounds/obstacleCourse';
import { circleIntersectsRect } from '../src/simulation/Collision';
import { ROBOT } from '../src/simulation/constants';

const GRID_CM = 2;

/** True when a robot centred here would not overlap anything. */
function isFree(arena: Arena, p: Vec2, radius: number): boolean {
  if (p.x < radius || p.y < radius) return false;
  if (p.x > arena.widthCm - radius || p.y > arena.heightCm - radius) return false;
  for (const obstacle of arena.obstacles) {
    if (circleIntersectsRect(p, radius, obstacle)) return false;
  }
  return true;
}

/**
 * Flood fill over free space at the robot's actual radius.
 *
 * A maze whose finish cannot physically be reached - or whose corridors are
 * narrower than the chassis - looks like a bug in the student's program rather
 * than a bug in the playground, so it is worth checking automatically.
 */
function reachableFrom(arena: Arena, start: Vec2, radius: number): Set<string> {
  const cols = Math.ceil(arena.widthCm / GRID_CM);
  const rows = Math.ceil(arena.heightCm / GRID_CM);
  const key = (cx: number, cy: number) => `${cx},${cy}`;

  const startCell = { cx: Math.round(start.x / GRID_CM), cy: Math.round(start.y / GRID_CM) };
  const seen = new Set<string>();
  const queue: { cx: number; cy: number }[] = [startCell];
  seen.add(key(startCell.cx, startCell.cy));

  while (queue.length > 0) {
    const { cx, cy } = queue.pop()!;
    const neighbours = [
      { cx: cx + 1, cy },
      { cx: cx - 1, cy },
      { cx, cy: cy + 1 },
      { cx, cy: cy - 1 },
    ];
    for (const n of neighbours) {
      if (n.cx < 0 || n.cy < 0 || n.cx > cols || n.cy > rows) continue;
      const id = key(n.cx, n.cy);
      if (seen.has(id)) continue;
      if (!isFree(arena, { x: n.cx * GRID_CM, y: n.cy * GRID_CM }, radius)) continue;
      seen.add(id);
      queue.push(n);
    }
  }

  return seen;
}

function zoneIsReachable(arena: Arena, zoneId: string, radius: number): boolean {
  const zone = arena.zones.find((z) => z.id === zoneId)!;
  const reachable = reachableFrom(arena, arena.start, radius);
  // Any grid cell inside the zone counts as arriving.
  for (let x = zone.x; x <= zone.x + zone.width; x += GRID_CM) {
    for (let y = zone.y; y <= zone.y + zone.height; y += GRID_CM) {
      if (reachable.has(`${Math.round(x / GRID_CM)},${Math.round(y / GRID_CM)}`)) return true;
    }
  }
  return false;
}

describe('maze', () => {
  it('places the robot in free space at the start', () => {
    expect(isFree(maze, maze.start, ROBOT.radiusCm)).toBe(true);
  });

  it('has a finish zone the robot can physically reach', () => {
    const finish = maze.zones.find((z) => z.goal);
    expect(finish).toBeDefined();
    expect(zoneIsReachable(maze, finish!.id, ROBOT.radiusCm)).toBe(true);
  });

  it('has corridors with clearance to spare, not a hairline solution', () => {
    // Solvable with 2 cm more chassis than the real robot means students are
    // not fighting a pixel-perfect gap.
    const finish = maze.zones.find((z) => z.goal)!;
    expect(zoneIsReachable(maze, finish.id, ROBOT.radiusCm + 2)).toBe(true);
  });

  it('connects every cell, so no part of the maze is walled off', () => {
    const reachable = reachableFrom(maze, maze.start, ROBOT.radiusCm);
    const unreachable = MAZE_CELL_CENTERS.filter(
      (centre) =>
        !reachable.has(`${Math.round(centre.x / GRID_CM)},${Math.round(centre.y / GRID_CM)}`),
    );
    expect(unreachable).toEqual([]);
  });

  it('contains dead ends, so it is worth solving', () => {
    // A cell reachable from only one direction is a dead end. Count cells whose
    // immediate neighbourhood is mostly blocked.
    const deadEnds = MAZE_CELL_CENTERS.filter((centre) => {
      const openSides = [
        { x: centre.x + 30, y: centre.y },
        { x: centre.x - 30, y: centre.y },
        { x: centre.x, y: centre.y + 30 },
        { x: centre.x, y: centre.y - 30 },
      ].filter((p) => isFree(maze, p, ROBOT.radiusCm)).length;
      return openSides <= 1;
    });
    expect(deadEnds.length).toBeGreaterThan(2);
  });
});

describe('obstacle course', () => {
  it('lets the robot get all the way across the room', () => {
    const reachable = reachableFrom(obstacleCourse, obstacleCourse.start, ROBOT.radiusCm);
    // The far side of the room must be reachable, or "keep driving" is
    // impossible however good the program is.
    const farSide = { x: obstacleCourse.widthCm - 30, y: obstacleCourse.heightCm - 30 };
    expect(reachable.has(`${Math.round(farSide.x / GRID_CM)},${Math.round(farSide.y / GRID_CM)}`)).toBe(
      true,
    );
  });
});
