import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { gridWorld } from '../src/playgrounds/gridWorld';
import { cloneArena } from '../src/playgrounds';
import {
  PHYSICS,
  clampMass,
  holdForceN,
  maxPushForceN,
  pushForceAlong,
} from '../src/simulation/RobotPhysics';
import { Robot } from '../src/simulation/Robot';
import { compassDegToHeading } from '../src/utils/units';

function advance(engine: SimulationEngine, ms: number, frameMs = 16) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(frameMs, remaining);
    engine.update(dt);
    remaining -= dt;
  }
}

/**
 * Sets up a head-on shove: the player starts facing right with the opponent
 * parked directly in its path, and drives at `motor` for `ms`.
 * Returns how far the opponent was moved along that axis.
 */
function shove(options: {
  motor: number;
  robotMassKg?: number;
  opponentMassKg?: number;
  ms?: number;
}): { opponentMovedCm: number; engine: SimulationEngine } {
  const arena = cloneArena(gridWorld);
  arena.start = { x: 60, y: 110, heading: compassDegToHeading(90) }; // facing +x
  const opponentStart = { x: 110, y: 110, heading: compassDegToHeading(90) };
  arena.opponentStart = opponentStart;

  const engine = new SimulationEngine(arena);
  engine.setParkedOpponent(opponentStart);
  engine.setMasses(options.robotMassKg ?? PHYSICS.defaultMassKg, options.opponentMassKg ?? PHYSICS.defaultMassKg);

  engine.beginProgram();
  engine.robot.setMotors(options.motor, options.motor);
  advance(engine, options.ms ?? 5000);

  return { opponentMovedCm: engine.opponent!.pose.x - opponentStart.x, engine };
}

describe('force model', () => {
  it('caps push force by traction, so a heavier robot can push harder', () => {
    const light = maxPushForceN(0.9, 255);
    const heavy = maxPushForceN(2.5, 255);
    expect(heavy).toBeGreaterThan(light);
  });

  it('never exceeds what the motors can deliver, however heavy the robot', () => {
    expect(maxPushForceN(500, 255)).toBeCloseTo(PHYSICS.motorForceMaxN, 6);
  });

  it('scales push force with the motor command', () => {
    const full = maxPushForceN(5, 255);
    const half = maxPushForceN(5, 128);
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(0);
  });

  it('makes a heavier robot harder to shove', () => {
    expect(holdForceN(3)).toBeGreaterThan(holdForceN(0.9));
  });

  it('counts only the component of the drive aimed at the other robot', () => {
    const robot = new Robot({ x: 0, y: 0, heading: 0 }); // facing +x
    robot.setMotors(255, 255);

    const headOn = pushForceAlong(robot, 1, 0);
    const glancing = pushForceAlong(robot, Math.SQRT1_2, Math.SQRT1_2);
    const away = pushForceAlong(robot, -1, 0);

    expect(headOn).toBeGreaterThan(glancing);
    expect(glancing).toBeGreaterThan(0);
    expect(away).toBe(0);
  });

  it('reports no push at all from a stopped robot', () => {
    const robot = new Robot({ x: 0, y: 0, heading: 0 });
    expect(pushForceAlong(robot, 1, 0)).toBe(0);
  });

  it('treats reversing as pushing backwards, not forwards', () => {
    const robot = new Robot({ x: 0, y: 0, heading: 0 });
    robot.setMotors(-255, -255);
    expect(pushForceAlong(robot, 1, 0)).toBe(0);
    expect(pushForceAlong(robot, -1, 0)).toBeGreaterThan(0);
  });

  it('clamps masses into a sane range', () => {
    expect(clampMass(0)).toBe(PHYSICS.minMassKg);
    expect(clampMass(9999)).toBe(PHYSICS.maxMassKg);
    expect(clampMass(Number.NaN)).toBe(PHYSICS.defaultMassKg);
    expect(clampMass(1.4)).toBeCloseTo(1.4, 6);
  });
});

describe('pushing another robot', () => {
  it('shoves an equal-mass opponent at full power', () => {
    const { opponentMovedCm, engine } = shove({ motor: 255 });
    expect(opponentMovedCm).toBeGreaterThan(20);
    engine.dispose();
  });

  it('cannot shift it at low power', () => {
    const { opponentMovedCm, engine } = shove({ motor: 40 });
    expect(Math.abs(opponentMovedCm)).toBeLessThan(0.5);
    engine.dispose();
  });

  it('cannot shift a much heavier opponent, even at full power', () => {
    const { opponentMovedCm, engine } = shove({ motor: 255, opponentMassKg: 8 });
    expect(Math.abs(opponentMovedCm)).toBeLessThan(0.5);
    engine.dispose();
  });

  it('can shift a heavy opponent once the player is loaded up too', () => {
    // Extra mass buys grip, which is the whole point of the traction cap: the
    // same 4.5 kg opponent that a default-weight robot cannot budge gives way
    // to a 4 kg one.
    const stock = shove({ motor: 255, opponentMassKg: 4.5 });
    expect(Math.abs(stock.opponentMovedCm)).toBeLessThan(0.5);
    stock.engine.dispose();

    const loaded = shove({ motor: 255, robotMassKg: 4, opponentMassKg: 4.5 });
    expect(loaded.opponentMovedCm).toBeGreaterThan(5);
    loaded.engine.dispose();
  });

  it('moves a light opponent further than a heavy one under the same push', () => {
    const light = shove({ motor: 255, opponentMassKg: 0.5 });
    const heavy = shove({ motor: 255, opponentMassKg: 2.0 });
    expect(light.opponentMovedCm).toBeGreaterThan(heavy.opponentMovedCm);
    light.engine.dispose();
    heavy.engine.dispose();
  });

  it('pushes the opponent away, never drags it backwards', () => {
    const { opponentMovedCm, engine } = shove({ motor: 255 });
    expect(opponentMovedCm).toBeGreaterThan(0);
    engine.dispose();
  });

  it('keeps the two chassis from overlapping throughout the shove', () => {
    const { engine } = shove({ motor: 255 });
    const gap = Math.hypot(
      engine.robot.pose.x - engine.opponent!.pose.x,
      engine.robot.pose.y - engine.opponent!.pose.y,
    );
    expect(gap).toBeGreaterThanOrEqual(engine.robot.radiusCm + engine.opponent!.radiusCm - 0.5);
    engine.dispose();
  });

  it('stops both robots when the shoved one is pinned against a wall', () => {
    const arena = cloneArena(gridWorld);
    arena.start = { x: 60, y: 110, heading: compassDegToHeading(90) };
    // Opponent parked hard against the right-hand wall.
    const opponentStart = {
      x: arena.widthCm - 14,
      y: 110,
      heading: compassDegToHeading(90),
    };
    arena.opponentStart = opponentStart;

    const engine = new SimulationEngine(arena);
    engine.setParkedOpponent(opponentStart);
    engine.beginProgram();
    engine.robot.setMotors(255, 255);
    advance(engine, 8000);

    // Neither robot escapes the arena, and they stay separated.
    expect(engine.opponent!.pose.x).toBeLessThanOrEqual(arena.widthCm);
    const gap = Math.hypot(
      engine.robot.pose.x - engine.opponent!.pose.x,
      engine.robot.pose.y - engine.opponent!.pose.y,
    );
    expect(gap).toBeGreaterThanOrEqual(engine.robot.radiusCm + engine.opponent!.radiusCm - 0.5);
    engine.dispose();
  });

  it('leaves mass out of ordinary driving speed', () => {
    // The drive model is speed-controlled, so a heavy robot covers the same
    // ground in open floor. Documented here so the behaviour is deliberate.
    const run = (massKg: number) => {
      const engine = new SimulationEngine(cloneArena(gridWorld));
      engine.setMasses(massKg, massKg);
      engine.beginProgram();
      engine.robot.setMotors(150, 150);
      advance(engine, 1000);
      const travelled = engine.robot.distanceTravelledCm;
      engine.dispose();
      return travelled;
    };
    expect(run(0.9)).toBeCloseTo(run(6), 3);
  });
});
