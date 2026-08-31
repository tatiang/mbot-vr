import { describe, expect, it } from 'vitest';
import { circleIntersectsRect, pushCircleOutOfRect, resolveCollisions } from '../src/simulation/Collision';
import type { Arena, Obstacle } from '../src/types';

const box: Obstacle = { id: 'b', kind: 'block', x: 100, y: 100, width: 40, height: 40 };

function arenaWith(obstacles: Obstacle[]): Arena {
  return {
    id: 'test',
    name: 'test',
    description: '',
    widthCm: 300,
    heightCm: 200,
    gridCm: 0,
    start: { x: 20, y: 20, heading: 0 },
    obstacles,
    lines: [],
    zones: [],
  };
}

describe('circle / rectangle collision', () => {
  it('detects overlap', () => {
    expect(circleIntersectsRect({ x: 95, y: 120 }, 10, box)).toBe(true);
  });

  it('reports no overlap when clear', () => {
    expect(circleIntersectsRect({ x: 80, y: 120 }, 10, box)).toBe(false);
    expect(pushCircleOutOfRect({ x: 80, y: 120 }, 10, box)).toBeNull();
  });

  it('pushes out along the shortest axis', () => {
    const push = pushCircleOutOfRect({ x: 95, y: 120 }, 10, box);
    expect(push).not.toBeNull();
    expect(push!.x).toBeCloseTo(-5, 6);
    expect(push!.y).toBeCloseTo(0, 6);
  });

  it('escapes a circle whose centre is inside the box', () => {
    const push = pushCircleOutOfRect({ x: 105, y: 120 }, 10, box);
    expect(push).not.toBeNull();
    // Nearest face is the left one at x = 100, 5 cm away.
    expect(push!.x).toBeCloseTo(-15, 6);
  });
});

describe('arena collision resolution', () => {
  it('keeps the robot inside the arena walls', () => {
    const arena = arenaWith([]);
    const result = resolveCollisions({ x: -20, y: 300, heading: 0 }, 8.5, arena);
    expect(result.collided).toBe(true);
    expect(result.pose.x).toBeCloseTo(8.5, 6);
    expect(result.pose.y).toBeCloseTo(200 - 8.5, 6);
  });

  it('leaves a robot in open space untouched', () => {
    const arena = arenaWith([box]);
    const result = resolveCollisions({ x: 50, y: 50, heading: 1 }, 8.5, arena);
    expect(result.collided).toBe(false);
    expect(result.pose).toEqual({ x: 50, y: 50, heading: 1 });
  });

  it('pushes the robot out of an obstacle', () => {
    const arena = arenaWith([box]);
    const result = resolveCollisions({ x: 96, y: 120, heading: 0 }, 8.5, arena);
    expect(result.collided).toBe(true);
    expect(result.pose.x).toBeLessThanOrEqual(100 - 8.5 + 1e-6);
  });

  it('settles cleanly in a corner formed by two obstacles', () => {
    const arena = arenaWith([
      box,
      { id: 'b2', kind: 'block', x: 60, y: 140, width: 40, height: 40 },
    ]);
    const result = resolveCollisions({ x: 99, y: 139, heading: 0 }, 8.5, arena);
    expect(result.collided).toBe(true);
    // After resolution it must not overlap either box.
    expect(circleIntersectsRect(result.pose, 8.5, arena.obstacles[0])).toBe(false);
    expect(circleIntersectsRect(result.pose, 8.5, arena.obstacles[1])).toBe(false);
  });

  it('separates two robots that overlap', () => {
    const arena = arenaWith([]);
    const result = resolveCollisions({ x: 100, y: 100, heading: 0 }, 8.5, arena, [
      { center: { x: 105, y: 100 }, radius: 8.5 },
    ]);
    expect(result.collided).toBe(true);
    const gap = Math.hypot(result.pose.x - 105, result.pose.y - 100);
    expect(gap).toBeCloseTo(17, 5);
  });
});
