import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { gridWorld } from '../src/playgrounds/gridWorld';
import { cloneArena } from '../src/playgrounds';

function makeEngine() {
  return new SimulationEngine(cloneArena(gridWorld));
}

/** Advances the engine by `ms` of wall-clock time in small frames. */
function advance(engine: SimulationEngine, ms: number, frameMs = 16) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(frameMs, remaining);
    engine.update(dt);
    remaining -= dt;
  }
}

describe('simulation engine', () => {
  it('starts the robot at the playground start pose', () => {
    const engine = makeEngine();
    expect(engine.robot.pose.x).toBeCloseTo(gridWorld.start.x, 6);
    expect(engine.robot.pose.y).toBeCloseTo(gridWorld.start.y, 6);
    engine.dispose();
  });

  it('moves the robot when a program drives the motors', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(200, 200);
    advance(engine, 1000);
    expect(engine.robot.distanceTravelledCm).toBeGreaterThan(20);
    engine.dispose();
  });

  it('scales elapsed simulated time by the speed control', () => {
    const engine = makeEngine();
    engine.speed = 2;
    advance(engine, 1000);
    expect(engine.clock).toBeGreaterThan(1.9);
    expect(engine.clock).toBeLessThan(2.1);
    engine.dispose();
  });

  it('resolves wait() against simulated time, not wall-clock time', async () => {
    const engine = makeEngine();
    let resolved = false;
    void engine.wait(1).then(() => {
      resolved = true;
    });

    advance(engine, 500);
    await Promise.resolve();
    expect(resolved).toBe(false);

    advance(engine, 600);
    await Promise.resolve();
    expect(resolved).toBe(true);
    engine.dispose();
  });

  it('makes waits finish sooner at higher speed', async () => {
    const engine = makeEngine();
    engine.speed = 4;
    let resolved = false;
    void engine.wait(1).then(() => {
      resolved = true;
    });
    advance(engine, 300);
    await Promise.resolve();
    expect(resolved).toBe(true);
    engine.dispose();
  });

  it('keeps the motors running when a program simply reaches its last block', () => {
    // A real mBot latches its motor state, which is why lessons end with a
    // `stop motors` block. Zeroing here would make a lone `move forward`
    // program look like Run did nothing at all.
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(120, 120);

    engine.endProgram(false);

    expect(engine.robot.leftMotor).toBe(120);
    expect(engine.robot.rightMotor).toBe(120);
    expect(engine.coasting).toBe(true);

    // ...and it really does keep driving on later frames.
    const before = { ...engine.robot.pose };
    advance(engine, 1000);
    expect(Math.hypot(engine.robot.pose.x - before.x, engine.robot.pose.y - before.y)).toBeGreaterThan(
      10,
    );
    engine.dispose();
  });

  it('cuts the motors when the run is stopped rather than finished', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(120, 120);

    engine.endProgram(true);

    expect(engine.robot.leftMotor).toBe(0);
    expect(engine.coasting).toBe(false);

    const before = { ...engine.robot.pose };
    advance(engine, 1000);
    expect(engine.robot.pose.x).toBeCloseTo(before.x, 6);
    expect(engine.robot.pose.y).toBeCloseTo(before.y, 6);
    engine.dispose();
  });

  it('stops a coasting robot when it is dragged', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(150, 150);
    engine.endProgram(false);
    expect(engine.coasting).toBe(true);

    engine.moveRobotTo(150, 100);

    expect(engine.robot.leftMotor).toBe(0);
    advance(engine, 500);
    expect(engine.robot.pose.x).toBeCloseTo(150, 6);
    engine.dispose();
  });

  it('stops the motors and releases pending waits when the program ends', async () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(255, 255);

    let resolved = false;
    void engine.wait(100).then(() => {
      resolved = true;
    });

    engine.endProgram();
    await Promise.resolve();

    expect(engine.robot.leftMotor).toBe(0);
    expect(engine.robot.rightMotor).toBe(0);
    expect(engine.programRunning).toBe(false);
    // Waits must not be left dangling, or the worker's promise leaks.
    expect(resolved).toBe(true);
    engine.dispose();
  });

  it('rate-limits robot API calls and refills the budget each frame', async () => {
    const engine = makeEngine();
    const settled: number[] = [];
    // Ask for far more slots than one frame allows.
    for (let i = 0; i < 40; i += 1) {
      void engine.nextSlot().then(() => settled.push(i));
    }
    await Promise.resolve();
    await Promise.resolve();
    const afterFirstBatch = settled.length;
    expect(afterFirstBatch).toBeGreaterThan(0);
    expect(afterFirstBatch).toBeLessThan(40);

    engine.update(16);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled.length).toBeGreaterThan(afterFirstBatch);
    engine.dispose();
  });

  it('restores pose, actuators and clock on reset', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(200, 120);
    engine.robot.setLed('all', { r: 255, g: 0, b: 0 });
    engine.robot.displayNumber(42);
    advance(engine, 800);
    engine.endProgram();

    engine.resetRobot();

    expect(engine.robot.pose.x).toBeCloseTo(gridWorld.start.x, 6);
    expect(engine.robot.pose.y).toBeCloseTo(gridWorld.start.y, 6);
    expect(engine.robot.leftMotor).toBe(0);
    expect(engine.robot.ledLeft).toEqual({ r: 0, g: 0, b: 0 });
    expect(engine.robot.display.trim()).toBe('');
    expect(engine.clock).toBe(0);
    expect(engine.robot.distanceTravelledCm).toBe(0);
    engine.dispose();
  });

  it('leaves the robot where it stopped rather than teleporting it', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(200, 200);
    advance(engine, 600);
    const { x, y } = engine.robot.pose;
    engine.endProgram();
    advance(engine, 200);
    expect(engine.robot.pose.x).toBeCloseTo(x, 6);
    expect(engine.robot.pose.y).toBeCloseTo(y, 6);
    engine.dispose();
  });

  it('keeps the robot inside the arena when it drives into a wall', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(255, 255);
    advance(engine, 20000, 32);
    expect(engine.robot.pose.x).toBeGreaterThanOrEqual(0);
    expect(engine.robot.pose.y).toBeGreaterThanOrEqual(0);
    expect(engine.robot.pose.x).toBeLessThanOrEqual(gridWorld.widthCm);
    expect(engine.robot.pose.y).toBeLessThanOrEqual(gridWorld.heightCm);
    engine.dispose();
  });

  it('ignores drag-to-move while a program is running', () => {
    const engine = makeEngine();
    engine.beginProgram();
    const before = { ...engine.robot.pose };
    engine.moveRobotTo(200, 100);
    expect(engine.robot.pose.x).toBeCloseTo(before.x, 6);
    engine.endProgram();
    engine.moveRobotTo(200, 100);
    expect(engine.robot.pose.x).toBeCloseTo(200, 6);
    engine.dispose();
  });

  it('only applies manual driving when no program owns the motors', () => {
    const engine = makeEngine();
    engine.manualDrive = { left: 200, right: 200 };
    advance(engine, 300);
    expect(engine.robot.leftMotor).toBe(200);

    engine.beginProgram();
    engine.robot.setMotors(0, 0);
    advance(engine, 300);
    // beginProgram clears manual drive, so the program's zero stands.
    expect(engine.robot.leftMotor).toBe(0);
    engine.dispose();
  });

  it('leaves idle motors alone instead of zeroing them every frame', () => {
    const engine = makeEngine();
    // No program, no manual input: whatever set the motors last still owns them.
    engine.robot.setMotors(90, 90);
    advance(engine, 200);
    expect(engine.robot.leftMotor).toBe(90);
    engine.dispose();
  });
});

describe('challenge tracking', () => {
  it('counts a there-and-back trip as returning to the start', () => {
    const engine = makeEngine();
    engine.beginProgram();

    // Out far enough to count as having left...
    engine.robot.setMotors(200, 200);
    advance(engine, 2000);
    expect(engine.challenges.stats.maxDistanceFromStartCm).toBeGreaterThan(25);
    expect(engine.challenges.stats.returnedToStart).toBe(false);

    // ...and back again.
    engine.robot.setMotors(-200, -200);
    advance(engine, 2000);
    expect(engine.challenges.stats.returnedToStart).toBe(true);
    engine.dispose();
  });

  it('does not count a wiggle on the start square as a trip', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(60, 60);
    advance(engine, 300);
    engine.robot.setMotors(-60, -60);
    advance(engine, 300);
    expect(engine.challenges.stats.returnedToStart).toBe(false);
    engine.dispose();
  });

  it('counts each bump once rather than once per physics step', () => {
    const engine = makeEngine();
    engine.beginProgram();
    engine.robot.setMotors(255, 255);
    advance(engine, 6000);
    // Driving into a wall and holding there is one collision event.
    expect(engine.challenges.stats.collisions).toBe(1);
    engine.dispose();
  });
});
