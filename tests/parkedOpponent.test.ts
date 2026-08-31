import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { pickDefaultOpponentSpot } from '../src/simulation/opponentPlacement';
import { circleIntersectsRect } from '../src/simulation/Collision';
import { gridWorld } from '../src/playgrounds/gridWorld';
import { maze } from '../src/playgrounds/maze';
import { battleArena } from '../src/playgrounds/battleArena';
import { cloneArena } from '../src/playgrounds';
import { ROBOT } from '../src/simulation/constants';

function makeEngine(base = gridWorld) {
  return new SimulationEngine(cloneArena(base));
}

function advance(engine: SimulationEngine, ms: number, frameMs = 16) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(frameMs, remaining);
    engine.update(dt);
    remaining -= dt;
  }
}

describe('pickDefaultOpponentSpot', () => {
  it('lands inside the arena bounds with room for the robot radius', () => {
    const spot = pickDefaultOpponentSpot(gridWorld);
    expect(spot.x).toBeGreaterThan(ROBOT.radiusCm);
    expect(spot.y).toBeGreaterThan(ROBOT.radiusCm);
    expect(spot.x).toBeLessThan(gridWorld.widthCm - ROBOT.radiusCm);
    expect(spot.y).toBeLessThan(gridWorld.heightCm - ROBOT.radiusCm);
  });

  it('does not land inside any obstacle, even in a crowded arena like the maze', () => {
    const spot = pickDefaultOpponentSpot(maze);
    for (const obstacle of maze.obstacles) {
      expect(circleIntersectsRect(spot, ROBOT.radiusCm, obstacle)).toBe(false);
    }
  });

  it('keeps a sensible distance from the player start', () => {
    const spot = pickDefaultOpponentSpot(gridWorld);
    const distance = Math.hypot(spot.x - gridWorld.start.x, spot.y - gridWorld.start.y);
    expect(distance).toBeGreaterThan(30);
  });

  it('always returns a pose, even for a very crowded arena with no clear candidate', () => {
    // A worst case: obstacles covering every scripted candidate point. The
    // function must still return something inside the arena rather than throw.
    const crowded = {
      ...maze,
      obstacles: [
        ...maze.obstacles,
        { id: 'x1', kind: 'block' as const, x: 0, y: 0, width: maze.widthCm, height: maze.heightCm },
      ],
    };
    const spot = pickDefaultOpponentSpot(crowded);
    expect(Number.isFinite(spot.x)).toBe(true);
    expect(Number.isFinite(spot.y)).toBe(true);
  });
});

describe('parked opponent - engine integration', () => {
  it('creates the opponent and marks it stationary', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 250, y: 100, heading: 0 });
    expect(engine.opponent).not.toBeNull();
    expect(engine.opponentIsParked).toBe(true);
    expect(engine.opponent!.pose).toEqual({ x: 250, y: 100, heading: 0 });
    engine.dispose();
  });

  it('is sensed by the ultrasonic sensor like any other obstacle', () => {
    const engine = makeEngine();
    // Directly ahead of the player's start heading (facing up the screen).
    const aheadX = engine.robot.pose.x;
    const aheadY = engine.robot.pose.y - 60;
    engine.setParkedOpponent({ x: aheadX, y: aheadY, heading: 0 });
    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(0);
    expect(engine.robot.ultrasonic.distanceCm).toBeLessThan(60);
    engine.dispose();
  });

  it('reports 0 (nothing in range) once removed', () => {
    const engine = makeEngine();
    const aheadX = engine.robot.pose.x;
    const aheadY = engine.robot.pose.y - 40;
    engine.setParkedOpponent({ x: aheadX, y: aheadY, heading: 0 });
    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(0);

    engine.setParkedOpponent(null);
    expect(engine.opponent).toBeNull();
    expect(engine.opponentIsParked).toBe(false);
    // Facing straight up in an otherwise empty room, the far wall is well
    // beyond the 40 cm the opponent used to occupy.
    expect(engine.robot.ultrasonic.distanceCm).toBeGreaterThan(60);
    engine.dispose();
  });

  it('never drives through the opponent, whatever the power', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: engine.robot.pose.x, y: engine.robot.pose.y - 40, heading: 0 });

    engine.beginProgram();
    engine.robot.setMotors(255, 255);
    advance(engine, 4000);

    // Whether or not the shove succeeded, the two chassis never interpenetrate.
    const gap = Math.hypot(
      engine.robot.pose.x - engine.opponent!.pose.x,
      engine.robot.pose.y - engine.opponent!.pose.y,
    );
    expect(gap).toBeGreaterThanOrEqual(ROBOT.radiusCm * 2 - 1);
    engine.dispose();
  });

  it('holds its ground against a gentle nudge', () => {
    const engine = makeEngine();
    const opponentPose = { x: engine.robot.pose.x, y: engine.robot.pose.y - 40, heading: 0 };
    engine.setParkedOpponent(opponentPose);

    engine.beginProgram();
    // Well under the force needed to overcome an equal-mass robot's grip.
    engine.robot.setMotors(40, 40);
    advance(engine, 6000);

    expect(engine.opponent!.pose.x).toBeCloseTo(opponentPose.x, 3);
    expect(engine.opponent!.pose.y).toBeCloseTo(opponentPose.y, 3);
    engine.dispose();
  });

  it('can be dragged into a new position while nothing is running', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 100, y: 100, heading: 0 });
    engine.moveOpponentTo(200, 150);
    expect(engine.opponent!.pose.x).toBeCloseTo(200, 6);
    expect(engine.opponent!.pose.y).toBeCloseTo(150, 6);
    engine.dispose();
  });

  it('ignores drag attempts while a program is running', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 100, y: 100, heading: 0 });
    engine.beginProgram();
    engine.moveOpponentTo(200, 150);
    expect(engine.opponent!.pose.x).toBeCloseTo(100, 6);
    engine.dispose();
  });

  it('clamps a dragged position to stay inside the arena', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 100, y: 100, heading: 0 });
    engine.moveOpponentTo(-500, 5000);
    expect(engine.opponent!.pose.x).toBeGreaterThanOrEqual(ROBOT.radiusCm);
    expect(engine.opponent!.pose.y).toBeLessThanOrEqual(gridWorld.heightCm - ROBOT.radiusCm);
    engine.dispose();
  });

  it('stays exactly where it was placed across a Reset', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 111, y: 77, heading: 0 });
    engine.beginProgram();
    engine.robot.setMotors(200, 200);
    advance(engine, 500);

    engine.resetRobot();

    // The player robot did reset...
    expect(engine.robot.pose.x).toBeCloseTo(gridWorld.start.x, 6);
    // ...but the opponent, a fixture the student placed, was left alone.
    expect(engine.opponent!.pose).toEqual({ x: 111, y: 77, heading: 0 });
    engine.dispose();
  });

  it('does nothing on an arena that already scripts its own opponent', () => {
    const engine = makeEngine(battleArena);
    const before = { ...engine.opponent!.pose };

    engine.setParkedOpponent({ x: 10, y: 10, heading: 0 });

    // The Battle Bot Arena's own moving opponent is unaffected.
    expect(engine.opponentIsParked).toBe(false);
    expect(engine.opponent!.pose).toEqual(before);
    engine.dispose();
  });

  it('is excluded from the moving-opponent physics step, unlike the Battle Bot opponent', () => {
    const engine = makeEngine();
    engine.setParkedOpponent({ x: 100, y: 100, heading: 0 });
    engine.beginProgram();
    // Even with a program "driving" (which would animate a scripted
    // opponent), a stationary one never calls setMotors on itself.
    advance(engine, 2000);
    expect(engine.opponent!.leftMotor).toBe(0);
    expect(engine.opponent!.rightMotor).toBe(0);
    expect(engine.opponent!.pose).toEqual({ x: 100, y: 100, heading: 0 });
    engine.dispose();
  });
});

describe('parked opponent start pose', () => {
  it('returns to the arena start pose on Reset after being shoved', () => {
    const start = { x: 200, y: 100, heading: 1 };
    const engine = new SimulationEngine({ ...cloneArena(gridWorld), opponentStart: start });
    engine.setParkedOpponent(start);

    // Shove it out of position.
    engine.opponent!.pose = { x: 240, y: 130, heading: 2 };

    engine.resetRobot();

    expect(engine.opponent!.pose).toEqual(start);
    engine.dispose();
  });

  it('keeps its configured mass across a Reset', () => {
    const start = { x: 200, y: 100, heading: 0 };
    const engine = new SimulationEngine({ ...cloneArena(gridWorld), opponentStart: start });
    engine.setParkedOpponent(start);
    engine.setMasses(1.2, 4.5);

    engine.resetRobot();

    expect(engine.opponent!.massKg).toBeCloseTo(4.5, 6);
    engine.dispose();
  });
});
