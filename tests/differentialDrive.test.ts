import { describe, expect, it } from 'vitest';
import { sanitizeMotors, stepDifferentialDrive } from '../src/simulation/DifferentialDrive';
import { MAX_WHEEL_SPEED_CM_S, WHEEL_TRACK_CM, radToDeg } from '../src/utils/units';

const origin = { x: 100, y: 100, heading: 0 }; // facing +x (right on screen)

describe('differential drive', () => {
  it('drives straight when both wheels match', () => {
    const after = stepDifferentialDrive(origin, 255, 255, 1);
    expect(after.x).toBeCloseTo(100 + MAX_WHEEL_SPEED_CM_S, 6);
    expect(after.y).toBeCloseTo(100, 6);
    expect(after.heading).toBeCloseTo(0, 6);
  });

  it('reverses when both wheels are negative', () => {
    const after = stepDifferentialDrive(origin, -255, -255, 1);
    expect(after.x).toBeCloseTo(100 - MAX_WHEEL_SPEED_CM_S, 6);
    expect(after.linearCmS).toBeLessThan(0);
  });

  it('does not move when both wheels are stopped', () => {
    const after = stepDifferentialDrive(origin, 0, 0, 1);
    expect(after.x).toBeCloseTo(100, 9);
    expect(after.y).toBeCloseTo(100, 9);
    expect(after.heading).toBeCloseTo(0, 9);
  });

  it('pivots on the spot with opposite wheel speeds', () => {
    const after = stepDifferentialDrive(origin, 255, -255, 0.5);
    // Centre stays put: the two wheel speeds cancel.
    expect(after.x).toBeCloseTo(100, 6);
    expect(after.y).toBeCloseTo(100, 6);
    // Left forward / right backward turns clockwise on screen, i.e. right.
    expect(after.heading).toBeGreaterThan(0);
    const expected = ((MAX_WHEEL_SPEED_CM_S * 2) / WHEEL_TRACK_CM) * 0.5;
    expect(after.heading).toBeCloseTo(expected, 6);
  });

  it('pivots the other way when the signs swap', () => {
    const after = stepDifferentialDrive(origin, -255, 255, 0.5);
    expect(after.heading).toBeLessThan(0);
  });

  it('curves towards the slower wheel', () => {
    const after = stepDifferentialDrive(origin, 50, 100, 1);
    // Right wheel faster, so the robot arcs to the left (anticlockwise).
    expect(after.heading).toBeLessThan(0);
    expect(after.x).toBeGreaterThan(100);
    expect(after.y).toBeLessThan(100);
  });

  it('traces the same arc whether integrated in one step or many', () => {
    const oneStep = stepDifferentialDrive(origin, 60, 140, 2);

    let pose = { ...origin };
    for (let i = 0; i < 200; i += 1) {
      const next = stepDifferentialDrive(pose, 60, 140, 2 / 200);
      pose = { x: next.x, y: next.y, heading: next.heading };
    }

    expect(pose.x).toBeCloseTo(oneStep.x, 6);
    expect(pose.y).toBeCloseTo(oneStep.y, 6);
    expect(pose.heading).toBeCloseTo(oneStep.heading, 6);
  });

  it('turns roughly 90 degrees with the values used by the "drive a square" example', () => {
    // turn right at 130 for 0.45 s - the tuning the starter program ships with.
    const after = stepDifferentialDrive(origin, 130, -130, 0.45);
    const degrees = radToDeg(after.heading);
    expect(degrees).toBeGreaterThan(85);
    expect(degrees).toBeLessThan(95);
  });

  it('clamps out-of-range motor commands', () => {
    expect(sanitizeMotors(400, -900)).toEqual([255, -255]);
    const after = stepDifferentialDrive(origin, 100000, 100000, 1);
    expect(after.x).toBeCloseTo(100 + MAX_WHEEL_SPEED_CM_S, 6);
  });
});
