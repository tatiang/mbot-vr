import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { defineMbotBlocks } from '../src/blocks/defineBlocks';
import { compileWorkspace } from '../src/blocks/compile';
import { STARTER_PROGRAMS } from '../src/blocks/starters';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { createEngineRuntime } from '../src/runtime/RobotRuntimeBridge';
import { lineFollowerCourse } from '../src/playgrounds/lineFollower';
import { cloneArena } from '../src/playgrounds';

defineMbotBlocks();

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;

function workspaceFrom(state: object): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
}

/**
 * Runs a starter program against a real engine, with no Worker involved, and
 * reports how long (in simulated seconds) it took to complete its first lap.
 *
 * The Worker is only a transport for the same `await robot.X()` calls the
 * runtime bridge already exposes directly, so driving the compiled code
 * against `createEngineRuntime` in-process is a faithful (and much faster)
 * way to check that an example actually completes the course it claims to.
 *
 * Each frame is separated by a *macrotask* boundary (`setImmediate`), not a
 * microtask one (`Promise.resolve()`): one loop iteration of the compiled
 * program is several chained `await`s (yield, then a sensor read, then a
 * motor write), each of which reschedules its continuation onto the back of
 * the microtask queue. A microtask-only boundary would only buy one hop of
 * ordering, so this loop would race ahead of that chain and call `update()`
 * again mid-iteration - starving it of simulated time exactly as calling it
 * twice before the robot asked for a turn would. `setImmediate` forces the
 * *entire* microtask queue to drain first, matching what a real
 * animation-frame boundary does in the browser.
 */
async function timeToFirstLap(
  starterId: string,
  frameBudget: number,
): Promise<{ seconds: number | null; collisions: number }> {
  const engine = new SimulationEngine(cloneArena(lineFollowerCourse));
  // Speeding the clock up (not the physics substep size, which stays fixed)
  // keeps this test fast without changing what actually happens.
  engine.speed = 4;
  engine.beginProgram();

  const starter = STARTER_PROGRAMS.find((s) => s.id === starterId)!;
  const workspace = workspaceFrom(starter.workspace as object);
  const { code } = compileWorkspace(workspace);
  workspace.dispose();

  let seconds: number | null = null;
  const program = new AsyncFunction('robot', code);
  void program(createEngineRuntime(engine)); // a "forever" program never resolves; that's expected
  for (let i = 0; i < frameBudget && seconds === null; i += 1) {
    engine.update(16);
    await new Promise((resolve) => setImmediate(resolve));
    if (engine.challenges.stats.laps >= 1) seconds = engine.clock;
  }

  const collisions = engine.challenges.stats.collisions;
  engine.dispose();
  return { seconds, collisions };
}

describe('Clumsy Line Follower', () => {
  it('completes at least one lap despite only reading one sensor', async () => {
    const result = await timeToFirstLap('line-follower-clumsy', 900);
    expect(result.seconds).not.toBeNull();
    expect(result.collisions).toBe(0);
  });

  it('is slower than the steady, two-sensor example - the cost of being clumsy', async () => {
    const clumsy = await timeToFirstLap('line-follower-clumsy', 900);
    const steady = await timeToFirstLap('line-follower', 900);
    expect(clumsy.seconds).not.toBeNull();
    expect(steady.seconds).not.toBeNull();
    // It gets there, but not as efficiently - that is what makes it the
    // rougher first attempt rather than simply an equally-good alternative.
    expect(clumsy.seconds!).toBeGreaterThan(steady.seconds!);
  });

  it('really does only use the left sensor, unlike the steady example', () => {
    const clumsy = STARTER_PROGRAMS.find((s) => s.id === 'line-follower-clumsy')!;
    const workspace = workspaceFrom(clumsy.workspace as object);
    const { code } = compileWorkspace(workspace);
    workspace.dispose();
    expect(code).toContain('isLeftLineSensorOnLine');
    expect(code).not.toContain('isRightLineSensorOnLine');
  });
});
