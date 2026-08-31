import { describe, expect, it } from 'vitest';
import { PLAYGROUNDS, cloneArena, getPlayground } from '../src/playgrounds';
import { circleIntersectsRect } from '../src/simulation/Collision';
import { isPointOnLine } from '../src/simulation/LineSensor';
import { ROBOT } from '../src/simulation/constants';
import { lineFollowerCourse } from '../src/playgrounds/lineFollower';

describe('playground definitions', () => {
  it.each(PLAYGROUNDS.map((p) => [p.name, p] as const))(
    '%s starts the robot in clear space',
    (_name, arena) => {
      const start = { x: arena.start.x, y: arena.start.y };
      for (const obstacle of arena.obstacles) {
        expect(circleIntersectsRect(start, ROBOT.radiusCm, obstacle)).toBe(false);
      }
    },
  );

  it.each(PLAYGROUNDS.map((p) => [p.name, p] as const))(
    '%s keeps the start pose inside the arena',
    (_name, arena) => {
      expect(arena.start.x).toBeGreaterThan(ROBOT.radiusCm);
      expect(arena.start.y).toBeGreaterThan(ROBOT.radiusCm);
      expect(arena.start.x).toBeLessThan(arena.widthCm - ROBOT.radiusCm);
      expect(arena.start.y).toBeLessThan(arena.heightCm - ROBOT.radiusCm);
    },
  );

  it.each(PLAYGROUNDS.map((p) => [p.name, p] as const))(
    '%s uses unique object ids',
    (_name, arena) => {
      const ids = [
        ...arena.obstacles.map((o) => o.id),
        ...arena.lines.map((l) => l.id),
        ...arena.zones.map((z) => z.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it('starts the line follower course with both sensors on the tape', () => {
    const { start } = lineFollowerCourse;
    // Reproduce the sensor offsets from the robot geometry.
    const cos = Math.cos(start.heading);
    const sin = Math.sin(start.heading);
    const project = (fwd: number, side: number) => ({
      x: start.x + fwd * cos - side * sin,
      y: start.y + fwd * sin + side * cos,
    });

    const left = project(ROBOT.lineSensorForwardCm, -ROBOT.lineSensorSideCm);
    const right = project(ROBOT.lineSensorForwardCm, ROBOT.lineSensorSideCm);

    expect(isPointOnLine(left, lineFollowerCourse, ROBOT.lineSensorRadiusCm)).toBe(true);
    expect(isPointOnLine(right, lineFollowerCourse, ROBOT.lineSensorRadiusCm)).toBe(true);
  });

  it('keeps the line follower course clear of the walls', () => {
    const margin = ROBOT.radiusCm + 4;
    for (const point of lineFollowerCourse.lines[0].points) {
      expect(point.x).toBeGreaterThan(margin);
      expect(point.y).toBeGreaterThan(margin);
      expect(point.x).toBeLessThan(lineFollowerCourse.widthCm - margin);
      expect(point.y).toBeLessThan(lineFollowerCourse.heightCm - margin);
    }
  });

  it('gives every playground with a goal challenge a goal zone', () => {
    const maze = getPlayground('maze');
    expect(maze.zones.some((z) => z.goal)).toBe(true);
  });

  it('falls back to Grid World for an unknown id', () => {
    expect(getPlayground('nope').id).toBe('grid');
  });

  it('deep-copies arenas so edits cannot leak into the shared definition', () => {
    const original = getPlayground('free');
    const copy = cloneArena(original);
    copy.obstacles.push({ id: 'x', kind: 'block', x: 0, y: 0, width: 5, height: 5 });
    copy.start.x = 999;
    expect(original.obstacles).not.toContainEqual(
      expect.objectContaining({ id: 'x' }),
    );
    expect(original.start.x).not.toBe(999);
  });
});
