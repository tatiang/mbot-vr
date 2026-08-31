/// <reference lib="webworker" />
import type { MainToWorker, RobotCall, WorkerToMain } from './protocol';

/**
 * Executes the student's generated program off the main thread.
 *
 * Every robot action is an `await`ed round trip to the simulator, so the worker
 * spends almost all of its time parked on a promise. A runaway `forever` loop
 * therefore burns no main-thread time, and `worker.terminate()` from the Stop
 * button kills it instantly even if it somehow does spin.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let nextCallId = 1;
const pending = new Map<number, (value: unknown) => void>();
let aborted = false;
let lastHighlightAt = 0;
let lastHighlightId: string | null = null;

function post(message: WorkerToMain): void {
  ctx.postMessage(message);
}

function call(request: RobotCall): Promise<unknown> {
  if (aborted) {
    // Park forever: the main thread is terminating us, and resolving would let
    // the program run one more statement against a stopped simulator.
    return new Promise<never>(() => {});
  }
  const id = nextCallId;
  nextCallId += 1;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    post({ type: 'call', id, call: request });
  });
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The API surface exposed to generated code. Names here are the contract the
 * Blockly generators emit against.
 */
const robot = {
  async setMotors(left: number, right: number): Promise<void> {
    await call({ fn: 'setMotors', args: [num(left), num(right)] });
  },
  async stop(): Promise<void> {
    await call({ fn: 'stop', args: [] });
  },
  async getUltrasonicDistance(): Promise<number> {
    return num(await call({ fn: 'getUltrasonicDistance', args: [] }));
  },
  async getLineFollowerValue(): Promise<number> {
    return num(await call({ fn: 'getLineFollowerValue', args: [] }));
  },
  async isLeftLineSensorOnLine(): Promise<boolean> {
    return Boolean(await call({ fn: 'isLeftLineSensorOnLine', args: [] }));
  },
  async isRightLineSensorOnLine(): Promise<boolean> {
    return Boolean(await call({ fn: 'isRightLineSensorOnLine', args: [] }));
  },
  async getX(): Promise<number> {
    return num(await call({ fn: 'getX', args: [] }));
  },
  async getY(): Promise<number> {
    return num(await call({ fn: 'getY', args: [] }));
  },
  async getHeading(): Promise<number> {
    return num(await call({ fn: 'getHeading', args: [] }));
  },
  async getTimer(): Promise<number> {
    return num(await call({ fn: 'getTimer', args: [] }));
  },
  async resetTimer(): Promise<void> {
    await call({ fn: 'resetTimer', args: [] });
  },
  async setRgbLed(which: 'left' | 'right' | 'all', r: number, g: number, b: number): Promise<void> {
    await call({ fn: 'setRgbLed', args: [which, num(r), num(g), num(b)] });
  },
  async displayNumber(value: number | string): Promise<void> {
    await call({ fn: 'displayNumber', args: [typeof value === 'string' ? value : num(value)] });
  },
  async wait(seconds: number): Promise<void> {
    await call({ fn: 'wait', args: [num(seconds)] });
  },
  /**
   * Yields once per loop iteration. This is what keeps an empty `forever` loop
   * from becoming a tight spin, and it is inserted automatically by the block
   * generators - students never see it.
   */
  async yield(): Promise<void> {
    await call({ fn: 'yield', args: [] });
  },
  /**
   * Reports which block is executing. Fire-and-forget and time-throttled: a
   * fast loop would otherwise post thousands of messages a second for a
   * highlight the eye cannot follow anyway.
   */
  highlight(blockId: string | null): void {
    const now = Date.now();
    if (blockId === lastHighlightId && now - lastHighlightAt < 60) return;
    lastHighlightId = blockId;
    lastHighlightAt = now;
    post({ type: 'highlight', blockId });
  },
};

const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;

async function run(code: string): Promise<void> {
  try {
    const program = new AsyncFunction('robot', code);
    await program(robot);
    if (!aborted) post({ type: 'finished' });
  } catch (error) {
    if (aborted) return;
    post({
      type: 'error',
      message: friendlyMessage(error),
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

/**
 * Turns a raw JavaScript exception into something a 10-year-old can act on.
 * The precise message is still sent along in `detail` for the console.
 */
function friendlyMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/is not a function/.test(raw)) {
    return 'A block tried to do something the robot does not know how to do. Check the blocks inside your loops.';
  }
  if (/Maximum call stack/.test(raw)) {
    return 'Your program repeated itself too many times in a row. Try adding a wait block inside the loop.';
  }
  if (/undefined|null/.test(raw) && /read|propert/i.test(raw)) {
    return 'A block was missing a value. Look for an empty white slot in your program.';
  }
  if (/SyntaxError/.test(String(error))) {
    return 'Some blocks could not be turned into a program. Try removing the last block you added.';
  }
  return 'Your program stopped because something unexpected happened. Try resetting the robot and running it again.';
}

ctx.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'run':
      aborted = false;
      void run(message.code);
      break;
    case 'reply': {
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message.value);
      }
      break;
    }
    case 'abort':
      aborted = true;
      pending.clear();
      break;
    default:
      break;
  }
};
