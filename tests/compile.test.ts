import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { defineMbotBlocks } from '../src/blocks/defineBlocks';
import { compileWorkspace, previewJavaScript } from '../src/blocks/compile';
import { EMPTY_WORKSPACE, STARTER_PROGRAMS } from '../src/blocks/starters';

defineMbotBlocks();

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

function workspaceFrom(state: object): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
}

/** Parses the generated body the same way the worker does. */
function parses(code: string): boolean {
  try {
    new AsyncFunction('robot', code);
    return true;
  } catch {
    return false;
  }
}

describe('compiling a workspace', () => {
  it('reports when there is no start block', () => {
    const workspace = new Blockly.Workspace();
    const result = compileWorkspace(workspace);
    expect(result.hasStart).toBe(false);
    expect(result.attachedBlocks).toBe(0);
    workspace.dispose();
  });

  it('reports an empty start block as having no attached blocks', () => {
    const workspace = workspaceFrom(EMPTY_WORKSPACE as object);
    const result = compileWorkspace(workspace);
    expect(result.hasStart).toBe(true);
    expect(result.attachedBlocks).toBe(0);
    expect(result.code.trim()).toBe('');
    workspace.dispose();
  });

  it('ignores stacks that are not attached to the start block', () => {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'mbot_when_start', x: 0, y: 0 },
          // A stray block parked off to the side must not run.
          {
            type: 'mbot_move_direction',
            x: 300,
            y: 300,
            fields: { DIRECTION: 'forward' },
            inputs: { POWER: { shadow: { type: 'math_number', fields: { NUM: 200 } } } },
          },
        ],
      },
    });
    const result = compileWorkspace(workspace);
    expect(result.code).not.toContain('200');
    workspace.dispose();
  });

  it('awaits every robot command', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'basic-driving')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('await robot.setMotors((50) * 2.55, (50) * 2.55)');
    expect(code).toContain('await robot.wait(2)');
    expect(code).toContain('await robot.stop()');
    // No bare robot call may escape the await, or Stop could not interrupt it.
    const bareCalls = code.match(/(?<!await )robot\.(?!highlight)[a-zA-Z]+\(/g);
    expect(bareCalls).toBeNull();
    workspace.dispose();
  });

  it('puts a yield at the top of every loop body', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'obstacle-avoid')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('while (true)');
    expect(code).toContain('await robot.yield()');
    workspace.dispose();
  });

  it('adds highlight calls only when asked', () => {
    const state = STARTER_PROGRAMS.find((s) => s.id === 'square')!.workspace as object;

    const plain = workspaceFrom(state);
    expect(compileWorkspace(plain, { highlight: false }).code).not.toContain('robot.highlight');
    plain.dispose();

    const highlighted = workspaceFrom(state);
    expect(compileWorkspace(highlighted, { highlight: true }).code).toContain('robot.highlight(');
    highlighted.dispose();
  });

  it('generates independent counters for nested repeats', () => {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type: 'mbot_repeat',
                inputs: {
                  TIMES: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
                  DO: {
                    block: {
                      type: 'mbot_repeat',
                      inputs: {
                        TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } },
                        DO: { block: { type: 'mbot_stop_motors' } },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    const { code } = compileWorkspace(workspace);
    // Two distinct loop variables, so the inner loop cannot clobber the outer.
    const counters = new Set(code.match(/for \(var (\w+)/g));
    expect(counters.size).toBe(2);
    expect(parses(code)).toBe(true);
    workspace.dispose();
  });
});

describe('starter programs', () => {
  it.each(STARTER_PROGRAMS.map((s) => [s.id, s] as const))(
    'compiles "%s" into a runnable async body',
    (_id, starter) => {
      const workspace = workspaceFrom(starter.workspace as object);
      const result = compileWorkspace(workspace, { highlight: true });

      expect(result.hasStart).toBe(true);
      expect(result.attachedBlocks).toBeGreaterThan(0);
      expect(parses(result.code)).toBe(true);
      workspace.dispose();
    },
  );

  it('builds a line follower that reads both sensors and sets each motor', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'line-follower')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('await robot.isLeftLineSensorOnLine()');
    expect(code).toContain('await robot.isRightLineSensorOnLine()');
    expect(code).toContain('await robot.setMotors((28) * 2.55, (60) * 2.55)');
    expect(code).toContain('await robot.setMotors((60) * 2.55, (28) * 2.55)');
    workspace.dispose();
  });

  it('guards the obstacle example against the sensor 0 / no-detection case', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'obstacle-avoid')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('< 20');
    expect(code).toContain('> 0');
    workspace.dispose();
  });

  it('builds the maze wall follower on the "is something closer than" block', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'maze-wall-follow')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('robot.getUltrasonicDistance()');
    expect(code).toContain('< (16)');
    workspace.dispose();
  });

  it('gives the clumsy line follower a single-sensor, weaving controller', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'line-follower-clumsy')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('await robot.isLeftLineSensorOnLine()');
    // The point of this example is that it never looks at the right sensor.
    expect(code).not.toContain('isRightLineSensorOnLine');
    workspace.dispose();
  });
});

describe('"is something closer than" block', () => {
  function compileObstacleWithin(distance: number): string {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type: 'controls_if',
                inputs: {
                  IF0: {
                    block: {
                      type: 'mbot_obstacle_within',
                      inputs: { DISTANCE: { shadow: { type: 'math_number', fields: { NUM: distance } } } },
                    },
                  },
                  DO0: { block: { type: 'mbot_stop_motors' } },
                },
              },
            },
          },
        ],
      },
    });
    const { code } = compileWorkspace(workspace);
    workspace.dispose();
    return code;
  }

  it('generates a self-contained expression that parses', () => {
    const code = compileObstacleWithin(20);
    expect(code).toContain('await robot.getUltrasonicDistance()');
    expect(parses(code)).toBe(true);
  });

  it('bakes in the ">0" no-detection guard, so students cannot forget it', async () => {
    const code = compileObstacleWithin(20);
    // Run the generated program against a stub robot and read back what the
    // condition actually decided, for a few representative sensor readings.
    const outcomes: Record<number, boolean> = {};
    for (const reading of [0, 5, 19, 20, 25]) {
      let stopped = false;
      const robot = {
        getUltrasonicDistance: async () => reading,
        stop: async () => {
          stopped = true;
        },
      };
      const program = new AsyncFunction('robot', code);
      await program(robot);
      outcomes[reading] = stopped;
    }
    expect(outcomes[0]).toBe(false); // "0" means nothing in range - must not trigger
    expect(outcomes[5]).toBe(true);
    expect(outcomes[19]).toBe(true);
    expect(outcomes[20]).toBe(false); // strictly less than the threshold
    expect(outcomes[25]).toBe(false);
  });
});

describe('JavaScript preview', () => {
  it('wraps the program in a named async function', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'basic-driving')!.workspace as object,
    );
    const preview = previewJavaScript(workspace);
    expect(preview).toContain('async function mbotProgram(robot)');
    expect(preview).not.toContain('robot.highlight');
    workspace.dispose();
  });

  it('explains itself when there is no start block', () => {
    const workspace = new Blockly.Workspace();
    expect(previewJavaScript(workspace)).toContain('when program starts');
    workspace.dispose();
  });
});

describe('multiple start blocks', () => {
  it('runs only the first stack and reports how many start blocks exist', () => {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            x: 0,
            y: 0,
            next: { block: { type: 'mbot_stop_motors' } },
          },
          {
            type: 'mbot_when_start',
            x: 300,
            y: 0,
            next: {
              block: {
                type: 'mbot_move_direction',
                fields: { DIRECTION: 'forward' },
                inputs: { POWER: { shadow: { type: 'math_number', fields: { NUM: 199 } } } },
              },
            },
          },
        ],
      },
    });
    const result = compileWorkspace(workspace);
    expect(result.startBlockCount).toBe(2);
    // Only one stack is compiled; the second one's power must not appear.
    expect(result.code).toContain('await robot.stop()');
    expect(result.code).not.toContain('199');
    workspace.dispose();
  });

  it('reports a single start block as one', () => {
    const workspace = workspaceFrom(EMPTY_WORKSPACE as object);
    expect(compileWorkspace(workspace).startBlockCount).toBe(1);
    workspace.dispose();
  });
});

describe('timed motion blocks', () => {
  const timed = (type: string, power: number, seconds: number) =>
    workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type,
                inputs: {
                  POWER: { shadow: { type: 'math_number', fields: { NUM: power } } },
                  SECONDS: { shadow: { type: 'math_number', fields: { NUM: seconds } } },
                },
              },
            },
          },
        ],
      },
    });

  it.each([
    ['mbot_move_forward_for', 'await robot.setMotors((50) * 2.55, (50) * 2.55);'],
    ['mbot_move_backward_for', 'await robot.setMotors(-((50) * 2.55), -((50) * 2.55));'],
    ['mbot_turn_left_for', 'await robot.setMotors(-((50) * 2.55), (50) * 2.55);'],
    ['mbot_turn_right_for', 'await robot.setMotors((50) * 2.55, -((50) * 2.55));'],
  ])('%s drives the right wheels', (type, expected) => {
    const workspace = timed(type, 50, 1.5);
    const { code } = compileWorkspace(workspace);
    expect(code).toContain(expected);
    workspace.dispose();
  });

  it('waits for the given time and then stops, so the block is self-contained', () => {
    const workspace = timed('mbot_move_forward_for', 55, 2.5);
    const { code } = compileWorkspace(workspace);
    // Order matters: drive, wait, stop.
    const drive = code.indexOf('setMotors((55) * 2.55, (55) * 2.55)');
    const waited = code.indexOf('robot.wait(2.5)');
    const stopped = code.indexOf('robot.stop()');
    expect(drive).toBeGreaterThanOrEqual(0);
    expect(waited).toBeGreaterThan(drive);
    expect(stopped).toBeGreaterThan(waited);
    expect(parses(code)).toBe(true);
    workspace.dispose();
  });

  it("scales power to the engine's -255..255 motor range, matching mBlock's 0-100% face", async () => {
    // 100% must reach full motor output, and only full output.
    const workspace = timed('mbot_move_forward_for', 100, 1);
    const { code } = compileWorkspace(workspace);
    const program = new AsyncFunction('robot', code);
    let seen: [number, number] | null = null;
    await program({
      setMotors: async (l: number, r: number) => {
        seen = [l, r];
      },
      wait: async () => {},
      stop: async () => {},
    });
    // Floating-point: 100 * 2.55 lands a hair under 255 (254.99999999999997).
    // The real motor call clamps and rounds this away (see Robot.setMotors /
    // clampMotor); this test checks the scaling factor, not that rounding.
    expect(seen![0]).toBeCloseTo(255, 6);
    expect(seen![1]).toBeCloseTo(255, 6);
    workspace.dispose();
  });

  it('accepts an expression for the duration, not just a number', () => {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type: 'mbot_move_forward_for',
                inputs: {
                  POWER: { shadow: { type: 'math_number', fields: { NUM: 100 } } },
                  SECONDS: {
                    shadow: { type: 'math_number', fields: { NUM: 1 } },
                    block: {
                      type: 'math_arithmetic',
                      fields: { OP: 'DIVIDE' },
                      inputs: {
                        A: { block: { type: 'math_number', fields: { NUM: 3 } } },
                        B: { block: { type: 'math_number', fields: { NUM: 2 } } },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });
    const { code } = compileWorkspace(workspace);
    expect(code).toContain('robot.wait(3 / 2)');
    expect(parses(code)).toBe(true);
    workspace.dispose();
  });

  it('leaves a program built from timed blocks with the motors stopped', () => {
    const workspace = workspaceFrom(
      STARTER_PROGRAMS.find((s) => s.id === 'basic-driving')!.workspace as object,
    );
    const { code } = compileWorkspace(workspace);
    expect(code.trimEnd().endsWith('await robot.stop();')).toBe(true);
    workspace.dispose();
  });
});

describe('continuous motion block (matches mBlock\'s dropdown Action block)', () => {
  const withDirection = (direction: string, power = 50) =>
    workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type: 'mbot_move_direction',
                fields: { DIRECTION: direction },
                inputs: { POWER: { shadow: { type: 'math_number', fields: { NUM: power } } } },
              },
            },
          },
        ],
      },
    });

  it.each([
    ['forward', 'await robot.setMotors((50) * 2.55, (50) * 2.55);'],
    ['backward', 'await robot.setMotors(-((50) * 2.55), -((50) * 2.55));'],
    ['left', 'await robot.setMotors(-((50) * 2.55), (50) * 2.55);'],
    ['right', 'await robot.setMotors((50) * 2.55, -((50) * 2.55));'],
  ])('"%s" drives the correct wheels and keeps running (no stop, no wait)', (direction, expected) => {
    const workspace = withDirection(direction);
    const { code } = compileWorkspace(workspace);
    expect(code.trim()).toBe(expected);
    workspace.dispose();
  });
});

describe('line follower sensor block (matches mBlock\'s "detects ... being ..." block)', () => {
  const detects = (side: 'leftside' | 'rightside', color: 'black' | 'white') =>
    workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'mbot_when_start',
            next: {
              block: {
                type: 'controls_if',
                inputs: {
                  IF0: { block: { type: 'mbot_line_detects', fields: { SIDE: side, COLOR: color } } },
                  DO0: { block: { type: 'mbot_stop_motors' } },
                },
              },
            },
          },
        ],
      },
    });

  it.each([
    ['leftside', 'isLeftLineSensorOnLine'],
    ['rightside', 'isRightLineSensorOnLine'],
  ] as const)('reads the %s sensor', (side, expectedCall) => {
    const workspace = detects(side, 'black');
    const { code } = compileWorkspace(workspace);
    expect(code).toContain(`robot.${expectedCall}()`);
    workspace.dispose();
  });

  it('"black" reports the sensor value directly; "white" reports its opposite', async () => {
    for (const [color, sensorReading, expected] of [
      ['black', true, true],
      ['black', false, false],
      ['white', true, false],
      ['white', false, true],
    ] as const) {
      const workspace = detects('leftside', color);
      const { code } = compileWorkspace(workspace);
      workspace.dispose();

      let stopped = false;
      const program = new AsyncFunction('robot', code);
      await program({
        isLeftLineSensorOnLine: async () => sensorReading,
        stop: async () => {
          stopped = true;
        },
      });
      expect(stopped).toBe(expected);
    }
  });
});

describe('reset timer block', () => {
  it('calls the runtime\'s resetTimer', async () => {
    const workspace = workspaceFrom({
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'mbot_when_start', next: { block: { type: 'mbot_reset_timer' } } }],
      },
    });
    const { code } = compileWorkspace(workspace);
    workspace.dispose();

    expect(code.trim()).toBe('await robot.resetTimer();');
    let called = false;
    const program = new AsyncFunction('robot', code);
    await program({
      resetTimer: async () => {
        called = true;
      },
    });
    expect(called).toBe(true);
  });
});
