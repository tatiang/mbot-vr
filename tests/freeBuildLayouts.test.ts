import { describe, expect, it } from 'vitest';
import { FREE_BUILD_LAYOUTS, freeBuildLayoutById } from '../src/playgrounds/freeBuildLayouts';
import { freeBuild } from '../src/playgrounds/freeBuild';
import { cloneArena } from '../src/playgrounds';
import { circleIntersectsRect } from '../src/simulation/Collision';
import { isPointOnLine } from '../src/simulation/LineSensor';
import { ROBOT } from '../src/simulation/constants';

describe('Free Build preset layouts', () => {
  it('offers at least two layouts', () => {
    expect(FREE_BUILD_LAYOUTS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FREE_BUILD_LAYOUTS.map((l) => [l.name, l] as const))(
    '"%s" keeps the default start position clear of its obstacles',
    (_name, layout) => {
      const arena = layout.apply(cloneArena(freeBuild));
      for (const obstacle of arena.obstacles) {
        expect(circleIntersectsRect(arena.start, ROBOT.radiusCm, obstacle)).toBe(false);
      }
    },
  );

  it.each(FREE_BUILD_LAYOUTS.map((l) => [l.name, l] as const))(
    '"%s" leaves the arena editable with its dimensions and id unchanged',
    (_name, layout) => {
      const before = cloneArena(freeBuild);
      const after = layout.apply(before);
      expect(after.id).toBe(freeBuild.id);
      expect(after.editable).toBe(true);
      expect(after.widthCm).toBe(freeBuild.widthCm);
      expect(after.heightCm).toBe(freeBuild.heightCm);
    },
  );

  it.each(FREE_BUILD_LAYOUTS.map((l) => [l.name, l] as const))(
    '"%s" preserves a start position the student already customised',
    (_name, layout) => {
      const moved = { ...cloneArena(freeBuild), start: { x: 200, y: 60, heading: 0 } };
      const after = layout.apply(moved);
      expect(after.start).toEqual({ x: 200, y: 60, heading: 0 });
    },
  );

  it('keeps the outer room walls, so the robot cannot look like it fell off the edge', () => {
    for (const layout of FREE_BUILD_LAYOUTS) {
      const arena = layout.apply(cloneArena(freeBuild));
      // Four border walls span the full width or height near each edge.
      const bordersFound = arena.obstacles.filter(
        (o) => o.width >= arena.widthCm - 1 || o.height >= arena.heightCm - 1,
      );
      expect(bordersFound.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('finds a layout by id, and returns undefined for an unknown one', () => {
    expect(freeBuildLayoutById(FREE_BUILD_LAYOUTS[0].id)).toBe(FREE_BUILD_LAYOUTS[0]);
    expect(freeBuildLayoutById('not-a-real-layout')).toBeUndefined();
  });

  it('produces fresh obstacle objects on every call, so loading twice cannot alias state', () => {
    const layout = FREE_BUILD_LAYOUTS[0];
    const a = layout.apply(cloneArena(freeBuild));
    const b = layout.apply(cloneArena(freeBuild));
    expect(a.obstacles).not.toBe(b.obstacles);
    if (a.obstacles.length > 0) expect(a.obstacles[0]).not.toBe(b.obstacles[0]);
  });

  describe('Practice Loop', () => {
    const loop = freeBuildLayoutById('free-practice-loop')!;

    it('produces a closed line course', () => {
      const arena = loop.apply(cloneArena(freeBuild));
      expect(arena.lines).toHaveLength(1);
      expect(arena.lines[0].closed).toBe(true);
      expect(arena.lines[0].points.length).toBeGreaterThan(8);
    });

    it('keeps the line comfortably inside the walls', () => {
      const arena = loop.apply(cloneArena(freeBuild));
      const margin = ROBOT.radiusCm;
      for (const p of arena.lines[0].points) {
        expect(p.x).toBeGreaterThan(margin);
        expect(p.y).toBeGreaterThan(margin);
        expect(p.x).toBeLessThan(arena.widthCm - margin);
        expect(p.y).toBeLessThan(arena.heightCm - margin);
      }
    });

    it('is thick enough for the line sensors to find', () => {
      const arena = loop.apply(cloneArena(freeBuild));
      const onCourse = arena.lines[0].points[0];
      expect(isPointOnLine(onCourse, arena, ROBOT.lineSensorRadiusCm)).toBe(true);
    });
  });

  describe('Obstacle Field', () => {
    const field = freeBuildLayoutById('free-obstacle-field')!;

    it('adds more than just the border walls', () => {
      const arena = field.apply(cloneArena(freeBuild));
      const inner = arena.obstacles.filter(
        (o) => o.width < arena.widthCm - 1 && o.height < arena.heightCm - 1,
      );
      expect(inner.length).toBeGreaterThan(0);
    });
  });
});
