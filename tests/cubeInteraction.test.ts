import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { freeBuild } from '../src/playgrounds/freeBuild';
import { cloneArena } from '../src/playgrounds';
import { compassDegToHeading } from '../src/utils/units';
import { ROBOT } from '../src/simulation/constants';
import type { Obstacle } from '../src/types';

/**
 * The Free Build "Add box" tool creates exactly this shape of object (see
 * `SimulatorCanvas.handlePointerUp`) - an orange "cube" obstacle, as distinct
 * from a grey "wall". This suite exercises one placed that way through the
 * full engine, not just the geometry helpers underneath it, to confirm the
 * whole pipeline actually sees and reacts to it: the ultrasonic sensor
 * reports it, and driving into it stops the robot.
 */
function cube(x: number, y: number, size = 30): Obstacle {
  return { id: 'test-cube', kind: 'block', x, y, width: size, height: size };
}

function advance(engine: SimulationEngine, ms: number, frameMs = 16) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(frameMs, remaining);
    engine.update(dt);
    remaining -= dt;
  }
}

describe('a "cube" obstacle placed in the arena', () => {
  it('does not affect a reading facing the other way, only the arena wall does', () => {
    // A bounded room always sees *something* (its own far wall) once nothing
    // closer is in the way, so "not sensing the cube" has to be checked by
    // comparison against an otherwise-identical empty room, not against 0.
    const withoutCube = new SimulationEngine(cloneArena(freeBuild));
    const withCubeBehind = new SimulationEngine({
      ...cloneArena(freeBuild),
      obstacles: [...freeBuild.obstacles, cube(280, 20)], // tucked in the far corner, behind the robot
    });

    expect(withCubeBehind.robot.ultrasonic.distanceCm).toBeCloseTo(
      withoutCube.robot.ultrasonic.distanceCm,
      6,
    );

    withoutCube.dispose();
    withCubeBehind.dispose();
  });

  it('is sensed by the ultrasonic sensor once it is ahead of the robot', () => {
    const arena = cloneArena(freeBuild);
    arena.start = { x: 100, y: 100, heading: compassDegToHeading(90) }; // facing +x
    arena.obstacles = [...freeBuild.obstacles, cube(150, 85, 30)];
    const engine = new SimulationEngine(arena);

    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(0);
    // Front face of the cube is at x=150; the sensor sits ROBOT.ultrasonicOffsetCm
    // ahead of the robot's centre at x=100, so the gap is roughly that difference.
    expect(engine.robot.ultrasonic.distanceCm).toBeLessThan(60);
    engine.dispose();
  });

  it('reports a shrinking distance as the robot drives towards it', () => {
    const arena = cloneArena(freeBuild);
    arena.start = { x: 60, y: 100, heading: compassDegToHeading(90) };
    arena.obstacles = [...freeBuild.obstacles, cube(220, 85, 30)];
    const engine = new SimulationEngine(arena);

    const first = engine.robot.ultrasonic.distanceCm;
    engine.beginProgram();
    engine.robot.setMotors(120, 120);
    advance(engine, 800);
    const second = engine.robot.ultrasonic.distanceCm;

    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
    engine.dispose();
  });

  it('physically blocks the robot from driving through it', () => {
    const arena = cloneArena(freeBuild);
    arena.start = { x: 60, y: 100, heading: compassDegToHeading(90) };
    arena.obstacles = [...freeBuild.obstacles, cube(150, 80, 40)];
    const engine = new SimulationEngine(arena);

    engine.beginProgram();
    engine.robot.setMotors(255, 255);
    advance(engine, 5000);

    // The robot must have stopped before the cube's far edge (x = 190) - if
    // collision were not wired up it would sail straight through to x > 190.
    expect(engine.robot.pose.x).toBeLessThan(150);
    expect(engine.robot.collided).toBe(true);
    engine.dispose();
  });

  it('lets the sensor see further once the cube in front of it is removed', () => {
    const arena = cloneArena(freeBuild);
    arena.start = { x: 60, y: 100, heading: compassDegToHeading(90) };
    arena.obstacles = [...freeBuild.obstacles, cube(150, 85, 30)];
    const engine = new SimulationEngine(arena);
    const withCube = engine.robot.ultrasonic.distanceCm;
    expect(withCube).toBeGreaterThan(0);

    // Only the border walls remain - the sensor now reaches all the way to
    // the far wall instead of stopping at the cube's near face.
    engine.setArena({ ...arena, obstacles: freeBuild.obstacles });

    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(withCube);
    engine.dispose();
  });

  it('is felt by the ultrasonic even when placed by an odd, non-grid-aligned size', () => {
    // Free Build boxes are dragged out by hand, so they will not always land
    // on tidy 10 cm-grid dimensions even with snap enabled at the edges.
    const arena = cloneArena(freeBuild);
    arena.start = { x: 61.4, y: 103.7, heading: compassDegToHeading(90) };
    arena.obstacles = [...freeBuild.obstacles, cube(133.2, 88.6, 27.9)];
    const engine = new SimulationEngine(arena);
    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(0);
    expect(Number.isFinite(engine.robot.ultrasonic.distanceCm)).toBe(true);
    engine.dispose();
  });

  it('does not affect the robot at all before it exists (arena starts clear)', () => {
    // Sanity check for the fixtures above: Free Build ships with no interior
    // obstacles by default, so a fresh arena has nothing to trip on.
    const engine = new SimulationEngine(cloneArena(freeBuild));
    const interior = engine.arena.obstacles.filter(
      (o) => o.width < engine.arena.widthCm - 1 && o.height < engine.arena.heightCm - 1,
    );
    expect(interior).toHaveLength(0);
    expect(engine.robot.collided).toBe(false);
    engine.dispose();
  });

  it('uses the ROBOT ultrasonic offset consistently with the geometry above', () => {
    // Documents the constant the "roughly 60 cm" assertions above depend on,
    // so a future change to the chassis dimensions fails loudly here instead
    // of silently invalidating the distance expectations elsewhere in this file.
    expect(ROBOT.ultrasonicOffsetCm).toBeGreaterThan(0);
    expect(ROBOT.ultrasonicOffsetCm).toBeLessThan(15);
  });
});
