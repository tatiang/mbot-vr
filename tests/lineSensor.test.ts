import { describe, expect, it } from 'vitest';
import {
  decodeLineFollower,
  encodeLineFollower,
  isPointOnLine,
  readLineSensors,
} from '../src/simulation/LineSensor';
import type { Arena } from '../src/types';

/**
 * The encoding is the compatibility contract with the real mBot firmware
 * (and with the original V-REP script), so it is pinned exactly.
 */
describe('line follower encoding', () => {
  it('matches the mBot firmware value table', () => {
    expect(encodeLineFollower(true, true)).toBe(0); // both on the line
    expect(encodeLineFollower(true, false)).toBe(1); // left on, right off
    expect(encodeLineFollower(false, true)).toBe(2); // left off, right on
    expect(encodeLineFollower(false, false)).toBe(3); // both off
  });

  it('round-trips through decode', () => {
    for (const left of [true, false]) {
      for (const right of [true, false]) {
        const value = encodeLineFollower(left, right);
        expect(decodeLineFollower(value)).toEqual({ leftOnLine: left, rightOnLine: right });
      }
    }
  });
});

const arena: Arena = {
  id: 'test',
  name: 'test',
  description: '',
  widthCm: 200,
  heightCm: 100,
  gridCm: 0,
  start: { x: 10, y: 10, heading: 0 },
  obstacles: [],
  zones: [],
  lines: [
    {
      id: 'l1',
      points: [
        { x: 20, y: 50 },
        { x: 180, y: 50 },
      ],
      width: 4,
      closed: false,
    },
  ],
};

describe('line sensor geometry', () => {
  it('detects a point sitting on the tape', () => {
    expect(isPointOnLine({ x: 100, y: 50 }, arena, 0.5)).toBe(true);
  });

  it('detects a point within half the tape width plus the eye radius', () => {
    // Tape half-width 2 + eye radius 0.5 = 2.5 cm tolerance.
    expect(isPointOnLine({ x: 100, y: 52.4 }, arena, 0.5)).toBe(true);
    expect(isPointOnLine({ x: 100, y: 52.6 }, arena, 0.5)).toBe(false);
  });

  it('does not detect past the end of a segment', () => {
    expect(isPointOnLine({ x: 190, y: 50 }, arena, 0.5)).toBe(false);
  });

  it('reports the pair of sensors as a firmware value', () => {
    const straddling = readLineSensors({ x: 100, y: 50 }, { x: 100, y: 70 }, arena, 0.5);
    expect(straddling).toEqual({ leftOnLine: true, rightOnLine: false, value: 1 });

    const bothOff = readLineSensors({ x: 100, y: 80 }, { x: 100, y: 90 }, arena, 0.5);
    expect(bothOff.value).toBe(3);

    const bothOn = readLineSensors({ x: 90, y: 50 }, { x: 110, y: 50 }, arena, 0.5);
    expect(bothOn.value).toBe(0);
  });

  it('follows a closed path across the wrap-around segment', () => {
    const closed: Arena = {
      ...arena,
      lines: [
        {
          id: 'loop',
          points: [
            { x: 20, y: 20 },
            { x: 80, y: 20 },
            { x: 80, y: 80 },
            { x: 20, y: 80 },
          ],
          width: 4,
          closed: true,
        },
      ],
    };
    // The segment from the last point back to the first only exists when the
    // path is closed.
    expect(isPointOnLine({ x: 20, y: 50 }, closed, 0.5)).toBe(true);
  });
});
