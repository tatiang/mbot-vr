import { describe, expect, it } from 'vitest';
import { readUltrasonic } from '../src/simulation/UltrasonicSensor';
import { rayRectIntersection } from '../src/utils/geometry';
import type { Arena, Obstacle } from '../src/types';

let boxSeq = 0;
function box(x: number, y: number, width: number, height: number): Obstacle {
  boxSeq += 1;
  return { id: `b${boxSeq}`, kind: 'block', x, y, width, height };
}

function makeArena(obstacles: Arena['obstacles']): Arena {
  return {
    id: 'test',
    name: 'test',
    description: '',
    widthCm: 400,
    heightCm: 400,
    gridCm: 0,
    start: { x: 10, y: 200, heading: 0 },
    obstacles,
    lines: [],
    zones: [],
  };
}

describe('ray / rectangle intersection', () => {
  it('finds the near face of a box straight ahead', () => {
    const hit = rayRectIntersection(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: -5, width: 10, height: 10 },
    );
    expect(hit).toBeCloseTo(10, 6);
  });

  it('misses a box that is off to the side', () => {
    const hit = rayRectIntersection(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 40, width: 10, height: 10 },
    );
    expect(hit).toBeNull();
  });

  it('ignores a box behind the ray origin', () => {
    const hit = rayRectIntersection(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -30, y: -5, width: 10, height: 10 },
    );
    expect(hit).toBeNull();
  });

  it('handles axis-aligned rays without dividing by zero', () => {
    const hit = rayRectIntersection(
      { x: 5, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 20, width: 10, height: 10 },
    );
    expect(hit).toBeCloseTo(20, 6);
  });
});

describe('ultrasonic sensor', () => {
  it('measures the distance to a box ahead', () => {
    const arena = makeArena([box(150, 180, 20, 40)]);
    const reading = readUltrasonic({ x: 100, y: 200 }, 0, arena);
    expect(reading.distanceCm).toBeCloseTo(50, 1);
    expect(reading.hitPoint).not.toBeNull();
  });

  it('sees the arena wall when nothing else is in the way', () => {
    const arena = makeArena([]);
    const reading = readUltrasonic({ x: 100, y: 200 }, 0, arena);
    // The far wall is 300 cm away and well inside the 400 cm range.
    expect(reading.distanceCm).toBeCloseTo(300, 1);
  });

  it('reports 0 when nothing is within range, matching the original firmware', () => {
    // A very wide arena puts every wall beyond the 400 cm maximum range.
    const arena: Arena = { ...makeArena([]), widthCm: 5000, heightCm: 5000 };
    const reading = readUltrasonic({ x: 100, y: 2500 }, 0, arena);
    expect(reading.distanceCm).toBe(0);
    expect(reading.hitPoint).toBeNull();
  });

  it('does not see an object behind the robot', () => {
    const arena = makeArena([box(20, 180, 20, 40)]);
    const reading = readUltrasonic({ x: 100, y: 200 }, 0, arena);
    // Facing +x, the box at x=20 is behind; the far wall is what it should see.
    expect(reading.distanceCm).toBeGreaterThan(250);
  });

  it('casts a fan of rays rather than a single line', () => {
    const arena = makeArena([]);
    const reading = readUltrasonic({ x: 200, y: 200 }, 0, arena);
    expect(reading.rays.length).toBeGreaterThan(1);
    // Edge rays point in different directions, so they reach different points.
    const first = reading.rays[0].end;
    const last = reading.rays[reading.rays.length - 1].end;
    expect(Math.abs(first.y - last.y)).toBeGreaterThan(1);
  });

  it('sees another robot as an obstacle', () => {
    const arena = makeArena([]);
    const reading = readUltrasonic({ x: 100, y: 200 }, 0, arena, [
      { center: { x: 160, y: 200 }, radius: 8.5 },
    ]);
    expect(reading.distanceCm).toBeCloseTo(51.5, 1);
  });

  it('never reports below the sensor minimum range', () => {
    const arena = makeArena([box(101, 180, 20, 40)]);
    const reading = readUltrasonic({ x: 100, y: 200 }, 0, arena);
    expect(reading.distanceCm).toBeGreaterThanOrEqual(3);
  });
});
