import type { Arena, LineFollowerValue, Vec2 } from '../types';
import { distanceToSegment } from '../utils/geometry';

export interface LineReading {
  leftOnLine: boolean;
  rightOnLine: boolean;
  /** The original mBot/Orion encoding - see {@link encodeLineFollower}. */
  value: LineFollowerValue;
}

/**
 * Encodes two line sensors into the value the real mBot firmware reports.
 *
 * From the original V-REP script (`ReadLineFollower`):
 *   value = leftOffLine * 2 + rightOffLine
 *
 *   0 - both sensors are over the line
 *   1 - left over the line, right off the line
 *   2 - left off the line, right over the line
 *   3 - both sensors are off the line
 *
 * Preserving this exact mapping is what lets a program developed in mBot VR be
 * carried across to a physical mBot unchanged.
 */
export function encodeLineFollower(leftOnLine: boolean, rightOnLine: boolean): LineFollowerValue {
  const left = leftOnLine ? 0 : 1;
  const right = rightOnLine ? 0 : 1;
  return (left * 2 + right) as LineFollowerValue;
}

/** Decodes a firmware value back into the two booleans. */
export function decodeLineFollower(value: LineFollowerValue): {
  leftOnLine: boolean;
  rightOnLine: boolean;
} {
  return {
    leftOnLine: (value & 2) === 0,
    rightOnLine: (value & 1) === 0,
  };
}

/** True when the sensor eye at `point` overlaps any painted line in the arena. */
export function isPointOnLine(point: Vec2, arena: Arena, sensorRadiusCm: number): boolean {
  for (const line of arena.lines) {
    const threshold = line.width / 2 + sensorRadiusCm;
    const points = line.points;
    if (points.length === 1) {
      const p = points[0];
      if (Math.hypot(point.x - p.x, point.y - p.y) <= threshold) return true;
      continue;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      if (distanceToSegment(point, points[i], points[i + 1]) <= threshold) return true;
    }
    if (line.closed && points.length > 2) {
      if (distanceToSegment(point, points[points.length - 1], points[0]) <= threshold) return true;
    }
  }
  return false;
}

export function readLineSensors(
  leftSensor: Vec2,
  rightSensor: Vec2,
  arena: Arena,
  sensorRadiusCm: number,
): LineReading {
  const leftOnLine = isPointOnLine(leftSensor, arena, sensorRadiusCm);
  const rightOnLine = isPointOnLine(rightSensor, arena, sensorRadiusCm);
  return { leftOnLine, rightOnLine, value: encodeLineFollower(leftOnLine, rightOnLine) };
}
