import { describe, expect, it } from 'vitest';
import {
  MOTOR_MAX,
  clampMotor,
  compassDegToHeading,
  headingToCompassDeg,
  motorToWheelSpeed,
  normalizeAngle,
} from '../src/utils/units';

describe('motor clamping', () => {
  it('keeps values inside the mBot range', () => {
    expect(clampMotor(0)).toBe(0);
    expect(clampMotor(255)).toBe(255);
    expect(clampMotor(-255)).toBe(-255);
    expect(clampMotor(1000)).toBe(MOTOR_MAX);
    expect(clampMotor(-1000)).toBe(-MOTOR_MAX);
  });

  it('rounds fractional speeds', () => {
    expect(clampMotor(120.6)).toBe(121);
  });

  it('treats nonsense input as stopped rather than throwing', () => {
    // A student dividing by zero should get a stopped wheel, not a runaway one.
    expect(clampMotor(Number.NaN)).toBe(0);
    expect(clampMotor(Infinity)).toBe(0);
    expect(clampMotor(-Infinity)).toBe(0);
  });

  it('scales linearly to wheel speed', () => {
    expect(motorToWheelSpeed(0)).toBe(0);
    expect(motorToWheelSpeed(255)).toBeCloseTo(40, 6);
    expect(motorToWheelSpeed(-255)).toBeCloseTo(-40, 6);
    expect(motorToWheelSpeed(128)).toBeCloseTo((128 / 255) * 40, 6);
  });
});

describe('heading conversion', () => {
  it('reports 0 degrees when facing up the screen', () => {
    expect(headingToCompassDeg(-Math.PI / 2)).toBeCloseTo(0, 6);
  });

  it('reports 90 degrees when facing right', () => {
    expect(headingToCompassDeg(0)).toBeCloseTo(90, 6);
  });

  it('round-trips', () => {
    for (const deg of [0, 45, 90, 180, 270, 359]) {
      expect(headingToCompassDeg(compassDegToHeading(deg))).toBeCloseTo(deg, 6);
    }
  });

  it('normalises angles into (-PI, PI]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 6);
  });
});
