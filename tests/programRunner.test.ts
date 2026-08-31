import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramRunner } from '../src/runtime/ProgramRunner';
import type { MbotRuntime } from '../src/runtime/RobotRuntimeBridge';
import type { WorkerToMain } from '../src/runtime/protocol';

/**
 * Stand-in for the real Worker.
 *
 * The point of these tests is the runner's contract - that Stop always
 * terminates, that replies stop flowing to a worker that has been killed, and
 * that protocol calls reach the runtime - none of which needs real threads.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor(
    public url: URL | string,
    public options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  /** Simulates the worker sending a message up to the main thread. */
  emit(message: WorkerToMain) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerToMain>);
  }
}

function makeRuntime(): MbotRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async setMotors(left, right) {
      calls.push(`setMotors(${left},${right})`);
    },
    async stop() {
      calls.push('stop()');
    },
    async getUltrasonicDistance() {
      calls.push('getUltrasonicDistance()');
      return 17.4;
    },
    async getLineFollowerValue() {
      calls.push('getLineFollowerValue()');
      return 1;
    },
    async isLeftLineSensorOnLine() {
      return true;
    },
    async isRightLineSensorOnLine() {
      return false;
    },
    async getX() {
      return 1;
    },
    async getY() {
      return 2;
    },
    async getHeading() {
      return 90;
    },
    async getTimer() {
      return 3;
    },
    async resetTimer() {
      calls.push('resetTimer()');
    },
    async setRgbLed(led, r, g, b) {
      calls.push(`setRgbLed(${led},${r},${g},${b})`);
    },
    async displayNumber(value) {
      calls.push(`displayNumber(${value})`);
    },
    async wait(seconds) {
      calls.push(`wait(${seconds})`);
    },
    async yield() {
      calls.push('yield()');
    },
  };
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});

const latest = () => FakeWorker.instances[FakeWorker.instances.length - 1];

describe('ProgramRunner lifecycle', () => {
  it('creates a module worker and sends the code to run', () => {
    const runner = new ProgramRunner(makeRuntime());
    runner.start('await robot.stop();');

    expect(FakeWorker.instances).toHaveLength(1);
    expect(latest().options?.type).toBe('module');
    expect(latest().posted).toEqual([{ type: 'run', code: 'await robot.stop();' }]);
    expect(runner.isRunning).toBe(true);
    runner.dispose();
  });

  it('terminates the worker immediately on stop', () => {
    const runner = new ProgramRunner(makeRuntime());
    runner.start('while (true) {}');
    const worker = latest();

    runner.stop();

    expect(worker.terminated).toBe(true);
    expect(runner.isRunning).toBe(false);
    // An abort is attempted first, but termination is the guarantee.
    expect(worker.posted).toContainEqual({ type: 'abort' });
    runner.dispose();
  });

  it('clears the block highlight when stopped', () => {
    const onHighlight = vi.fn();
    const runner = new ProgramRunner(makeRuntime(), { onHighlight });
    runner.start('while (true) {}');
    runner.stop();
    expect(onHighlight).toHaveBeenCalledWith(null);
    runner.dispose();
  });

  it('replaces the previous worker when run twice, so nothing leaks', () => {
    const runner = new ProgramRunner(makeRuntime());
    runner.start('a');
    const first = latest();
    runner.start('b');

    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(latest().terminated).toBe(false);
    runner.dispose();
  });

  it('can be run again after being stopped', () => {
    const runner = new ProgramRunner(makeRuntime());
    runner.start('a');
    runner.stop();
    expect(runner.isRunning).toBe(false);

    runner.start('b');
    expect(runner.isRunning).toBe(true);
    expect(latest().terminated).toBe(false);
    runner.dispose();
  });

  it('is safe to stop when nothing is running', () => {
    const runner = new ProgramRunner(makeRuntime());
    expect(() => runner.stop()).not.toThrow();
    expect(runner.isRunning).toBe(false);
  });
});

describe('ProgramRunner message handling', () => {
  it('routes a robot call to the runtime and replies with the value', async () => {
    const runtime = makeRuntime();
    const runner = new ProgramRunner(runtime);
    runner.start('code');
    const worker = latest();

    worker.emit({ type: 'call', id: 7, call: { fn: 'getUltrasonicDistance', args: [] } });
    await vi.waitFor(() => expect(worker.posted.length).toBeGreaterThan(1));

    expect(runtime.calls).toContain('getUltrasonicDistance()');
    expect(worker.posted).toContainEqual({ type: 'reply', id: 7, value: 17.4 });
    runner.dispose();
  });

  it('passes motor arguments through unchanged', async () => {
    const runtime = makeRuntime();
    const runner = new ProgramRunner(runtime);
    runner.start('code');
    const worker = latest();

    worker.emit({ type: 'call', id: 1, call: { fn: 'setMotors', args: [140, -80] } });
    await vi.waitFor(() => expect(runtime.calls).toContain('setMotors(140,-80)'));
    runner.dispose();
  });

  it('does not reply to a worker that has already been terminated', async () => {
    const runtime = makeRuntime();
    const runner = new ProgramRunner(runtime);
    runner.start('code');
    const worker = latest();
    const before = worker.posted.length;

    worker.emit({ type: 'call', id: 2, call: { fn: 'getUltrasonicDistance', args: [] } });
    // Stop lands before the awaited runtime call resolves.
    runner.stop();

    await new Promise((resolve) => setTimeout(resolve, 10));
    // Only the abort message was added; no reply went to the dead worker.
    expect(worker.posted.filter((m) => (m as { type: string }).type === 'reply')).toHaveLength(0);
    expect(worker.posted.length).toBe(before + 1);
    runner.dispose();
  });

  it('forwards highlight messages', () => {
    const onHighlight = vi.fn();
    const runner = new ProgramRunner(makeRuntime(), { onHighlight });
    runner.start('code');
    latest().emit({ type: 'highlight', blockId: 'block-1' });
    expect(onHighlight).toHaveBeenCalledWith('block-1');
    runner.dispose();
  });

  it('reports completion and tears the worker down', () => {
    const onFinished = vi.fn();
    const runner = new ProgramRunner(makeRuntime(), { onFinished });
    runner.start('code');
    const worker = latest();

    worker.emit({ type: 'finished' });

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(runner.isRunning).toBe(false);
    expect(worker.terminated).toBe(true);
  });

  it('surfaces a friendly error message and stops the run', () => {
    const onError = vi.fn();
    const runner = new ProgramRunner(makeRuntime(), { onError });
    runner.start('code');
    const worker = latest();

    worker.emit({ type: 'error', message: 'Something went wrong.', detail: 'TypeError: x' });

    expect(onError).toHaveBeenCalledWith('Something went wrong.', 'TypeError: x');
    expect(runner.isRunning).toBe(false);
    expect(worker.terminated).toBe(true);
  });
});
