/**
 * Message protocol between the main thread and the program worker.
 *
 * The worker never touches the simulator directly. It asks for actions and
 * readings by message and awaits the reply, which means the only way a runaway
 * student program can affect the app is by asking for more work - and the
 * engine rate-limits that.
 */

/** Robot API calls the worker may request. */
export type RobotCall =
  | { fn: 'setMotors'; args: [number, number] }
  | { fn: 'stop'; args: [] }
  | { fn: 'getUltrasonicDistance'; args: [] }
  | { fn: 'getLineFollowerValue'; args: [] }
  | { fn: 'isLeftLineSensorOnLine'; args: [] }
  | { fn: 'isRightLineSensorOnLine'; args: [] }
  | { fn: 'getX'; args: [] }
  | { fn: 'getY'; args: [] }
  | { fn: 'getHeading'; args: [] }
  | { fn: 'getTimer'; args: [] }
  | { fn: 'resetTimer'; args: [] }
  | { fn: 'setRgbLed'; args: ['left' | 'right' | 'all', number, number, number] }
  | { fn: 'displayNumber'; args: [number | string] }
  | { fn: 'wait'; args: [number] }
  | { fn: 'yield'; args: [] };

export type MainToWorker =
  | { type: 'run'; code: string }
  | { type: 'reply'; id: number; value: unknown }
  | { type: 'abort' };

export type WorkerToMain =
  | { type: 'call'; id: number; call: RobotCall }
  | { type: 'highlight'; blockId: string | null }
  | { type: 'finished' }
  | { type: 'error'; message: string; detail: string };

/** Names the generated program is not allowed to shadow. */
export const RESERVED_WORDS = ['robot', '__runProgram', '__mbotHalt', 'self', 'postMessage'];
