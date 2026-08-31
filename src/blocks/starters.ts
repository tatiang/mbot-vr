/**
 * Example programs students can load and modify.
 *
 * These are Blockly serialization payloads built with small helpers rather than
 * hand-written JSON, so they stay readable and are checked by the compiler when
 * block names change.
 */

type Ser = Record<string, unknown>;

const numShadow = (n: number): Ser => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const numBlock = (n: number): Ser => ({ block: { type: 'math_number', fields: { NUM: n } } });

/** Links a list of statement blocks into a `next` chain. */
function chain(blocks: Ser[]): Ser | undefined {
  if (blocks.length === 0) return undefined;
  for (let i = 0; i < blocks.length - 1; i += 1) {
    blocks[i].next = { block: blocks[i + 1] };
  }
  return blocks[0];
}

/** Wraps a stack under a "when program starts" hat. */
function program(blocks: Ser[]): Ser {
  const first = chain(blocks);
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'mbot_when_start',
          x: 48,
          y: 48,
          ...(first ? { next: { block: first } } : {}),
        },
      ],
    },
  };
}

// --- statement helpers -----------------------------------------------------
//
// All power values here are the same 0-100% unit the blocks show on their
// face (matching mBlock), not the engine's internal -255..255 motor scale.

const forwardFor = (power: number, seconds: number): Ser => ({
  type: 'mbot_move_forward_for',
  inputs: { POWER: numShadow(power), SECONDS: numShadow(seconds) },
});
const turnRightFor = (power: number, seconds: number): Ser => ({
  type: 'mbot_turn_right_for',
  inputs: { POWER: numShadow(power), SECONDS: numShadow(seconds) },
});
const direction = (dir: 'forward' | 'backward' | 'left' | 'right', power: number): Ser => ({
  type: 'mbot_move_direction',
  fields: { DIRECTION: dir },
  inputs: { POWER: numShadow(power) },
});
const forward = (power: number): Ser => direction('forward', power);
const backward = (power: number): Ser => direction('backward', power);
const turnRight = (power: number): Ser => direction('right', power);
const motors = (left: number, right: number): Ser => ({
  type: 'mbot_set_motors',
  inputs: { LEFT: numShadow(left), RIGHT: numShadow(right) },
});
const stopMotors = (): Ser => ({ type: 'mbot_stop_motors' });
const wait = (seconds: number): Ser => ({
  type: 'mbot_wait',
  inputs: { SECONDS: numShadow(seconds) },
});
const repeat = (times: number, body: Ser[]): Ser => ({
  type: 'mbot_repeat',
  inputs: { TIMES: numShadow(times), ...statementInput('DO', body) },
});
const forever = (body: Ser[]): Ser => ({
  type: 'mbot_forever',
  inputs: { ...statementInput('DO', body) },
});
const led = (which: 'all' | 'left' | 'right', color: string): Ser => ({
  type: 'mbot_set_led_named',
  fields: { WHICH: which, COLOR: color },
});
const display = (value: number): Ser => ({
  type: 'mbot_display_number',
  inputs: { VALUE: numShadow(value) },
});

function statementInput(name: string, body: Ser[]): Ser {
  const first = chain(body);
  return first ? { [name]: { block: first } } : {};
}

// --- expression helpers ----------------------------------------------------

const ultrasonic = (): Ser => ({ block: { type: 'mbot_ultrasonic' } });
const obstacleWithin = (cm: number): Ser => ({
  block: { type: 'mbot_obstacle_within', inputs: { DISTANCE: numShadow(cm) } },
});
const leftOnLine = (): Ser => ({ block: { type: 'mbot_left_on_line' } });
const rightOnLine = (): Ser => ({ block: { type: 'mbot_right_on_line' } });

const compare = (op: 'LT' | 'GT' | 'EQ', a: Ser, b: Ser): Ser => ({
  block: { type: 'logic_compare', fields: { OP: op }, inputs: { A: a, B: b } },
});
const and = (a: Ser, b: Ser): Ser => ({
  block: { type: 'logic_operation', fields: { OP: 'AND' }, inputs: { A: a, B: b } },
});

/** Builds a controls_if with any number of else-if branches and an optional else. */
function ifBlock(
  branches: { condition: Ser; body: Ser[] }[],
  elseBody?: Ser[],
): Ser {
  const inputs: Ser = {};
  branches.forEach((branch, index) => {
    inputs[`IF${index}`] = branch.condition;
    Object.assign(inputs, statementInput(`DO${index}`, branch.body));
  });
  if (elseBody) Object.assign(inputs, statementInput('ELSE', elseBody));

  const extraState: Ser = {};
  if (branches.length > 1) extraState.elseIfCount = branches.length - 1;
  if (elseBody) extraState.hasElse = true;

  return {
    type: 'controls_if',
    ...(Object.keys(extraState).length ? { extraState } : {}),
    inputs,
  };
}

// --- the starter programs --------------------------------------------------

export interface StarterProgram {
  id: string;
  name: string;
  description: string;
  /** Playground this example is designed for. */
  playgroundId: string;
  workspace: Ser;
}

export const STARTER_PROGRAMS: StarterProgram[] = [
  {
    id: 'basic-driving',
    name: 'Basic driving',
    description: 'One block: drive forward for two seconds, then stop.',
    playgroundId: 'grid',
    workspace: program([forwardFor(50, 2)]),
  },
  {
    id: 'basic-driving-steps',
    name: 'Basic driving, step by step',
    description: 'The same trip written out as three blocks: drive, wait, stop.',
    playgroundId: 'grid',
    // Worth keeping alongside the one-block version: it shows what the timed
    // block is doing underneath, which is the model needed for control loops.
    workspace: program([forward(50), wait(2), stopMotors()]),
  },
  {
    id: 'square',
    name: 'Drive a square',
    description: 'Repeat "forward then turn" four times to trace a square.',
    playgroundId: 'grid',
    workspace: program([repeat(4, [forwardFor(55, 1), turnRightFor(50, 0.45)])]),
  },
  {
    id: 'lights',
    name: 'Lights and display',
    description: 'Flash the onboard LEDs and count on the four-digit display.',
    playgroundId: 'grid',
    workspace: program([
      repeat(3, [
        led('all', '255,0,0'),
        display(1),
        wait(0.4),
        led('all', '0,200,60'),
        display(2),
        wait(0.4),
        led('all', '0,80,255'),
        display(3),
        wait(0.4),
      ]),
      led('all', '0,0,0'),
      { type: 'mbot_clear_display' },
    ]),
  },
  {
    id: 'obstacle-avoid',
    name: 'Obstacle avoidance',
    description: 'Drive forward, and back up and turn whenever something is close.',
    playgroundId: 'obstacles',
    workspace: program([
      forever([
        ifBlock(
          [
            {
              // "distance > 0" matters: the sensor reports 0 for "nothing in
              // range", which would otherwise look like "something touching us".
              condition: and(
                compare('LT', ultrasonic(), numBlock(20)),
                compare('GT', ultrasonic(), numBlock(0)),
              ),
              body: [backward(55), wait(0.3), turnRight(55), wait(0.4)],
            },
          ],
          [forward(60)],
        ),
      ]),
    ]),
  },
  {
    id: 'line-follower-clumsy',
    name: 'Clumsy Line Follower',
    description:
      'A rough first attempt: reads only the left sensor, so it weaves down the track. Works because the tape is thick.',
    playgroundId: 'line',
    workspace: program([
      forever([
        ifBlock([{ condition: leftOnLine(), body: [motors(25, 60)] }], [motors(60, 10)]),
      ]),
    ]),
  },
  {
    id: 'line-follower',
    name: 'Line follower',
    description:
      'Steadier than the clumsy version: reads both sensors, so it corrects gently instead of weaving.',
    playgroundId: 'line',
    workspace: program([
      forever([
        ifBlock(
          [
            { condition: and(leftOnLine(), rightOnLine()), body: [motors(55, 55)] },
            { condition: leftOnLine(), body: [motors(28, 60)] },
            { condition: rightOnLine(), body: [motors(60, 28)] },
          ],
          [motors(-30, 30)],
        ),
      ]),
    ]),
  },
  {
    id: 'maze-wall-follow',
    name: 'Maze wall follower',
    description:
      'Creep forward and turn away whenever a wall gets close. Uses the "is something closer than" block.',
    playgroundId: 'maze',
    workspace: program([
      forever([
        ifBlock(
          [{ condition: obstacleWithin(16), body: [turnRight(47), wait(0.25)] }],
          [forward(43)],
        ),
      ]),
    ]),
  },
];

/** An empty project: just the start block, positioned where students expect it. */
export const EMPTY_WORKSPACE: Ser = program([]);

export function starterById(id: string): StarterProgram | undefined {
  return STARTER_PROGRAMS.find((s) => s.id === id);
}
