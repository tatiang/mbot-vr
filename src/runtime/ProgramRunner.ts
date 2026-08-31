import type { MainToWorker, RobotCall, WorkerToMain } from './protocol';
import type { MbotRuntime } from './RobotRuntimeBridge';

export interface ProgramRunnerCallbacks {
  onHighlight?: (blockId: string | null) => void;
  onFinished?: () => void;
  onError?: (message: string, detail: string) => void;
}

/**
 * Owns the program worker's lifetime.
 *
 * A fresh worker is created for every run and terminated on every stop. That is
 * slightly wasteful, but it is the only way to guarantee that Stop always works
 * - there is no cooperative shutdown to negotiate with a program that may be in
 * an infinite loop, and no state can leak from one run into the next.
 */
export class ProgramRunner {
  private worker: Worker | null = null;
  private running = false;

  constructor(
    private runtime: MbotRuntime,
    private callbacks: ProgramRunnerCallbacks = {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(code: string): void {
    this.terminate();
    this.running = true;

    // `new URL(..., import.meta.url)` is what lets Vite bundle the worker for
    // both the dev server and the static production build.
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'mbot-program',
    });
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      void this.handleMessage(worker, event.data);
    };

    worker.onerror = (event) => {
      this.callbacks.onError?.(
        'Your program could not start. Try removing the last block you added.',
        event.message ?? 'Worker error',
      );
      this.stop();
    };

    this.send(worker, { type: 'run', code });
  }

  /** Immediately kills the running program. Safe to call when nothing is running. */
  stop(): void {
    this.terminate();
    this.running = false;
    this.callbacks.onHighlight?.(null);
  }

  dispose(): void {
    this.terminate();
  }

  private terminate(): void {
    if (!this.worker) return;
    // Tell the worker to stop resolving calls, then kill it outright. The abort
    // message is best-effort; terminate() is the guarantee.
    try {
      this.send(this.worker, { type: 'abort' });
    } catch {
      // The worker may already be gone; nothing to do.
    }
    this.worker.terminate();
    this.worker = null;
  }

  private send(worker: Worker, message: MainToWorker): void {
    worker.postMessage(message);
  }

  private async handleMessage(worker: Worker, message: WorkerToMain): Promise<void> {
    switch (message.type) {
      case 'call': {
        const value = await this.dispatch(message.call);
        // The run may have been stopped while we awaited the simulator.
        if (this.worker !== worker) return;
        this.send(worker, { type: 'reply', id: message.id, value });
        break;
      }
      case 'highlight':
        this.callbacks.onHighlight?.(message.blockId);
        break;
      case 'finished':
        this.running = false;
        this.terminate();
        this.callbacks.onHighlight?.(null);
        this.callbacks.onFinished?.();
        break;
      case 'error':
        this.running = false;
        this.terminate();
        this.callbacks.onHighlight?.(null);
        this.callbacks.onError?.(message.message, message.detail);
        break;
      default:
        break;
    }
  }

  /** Routes one protocol call to the typed runtime. */
  private async dispatch(call: RobotCall): Promise<unknown> {
    const r = this.runtime;
    switch (call.fn) {
      case 'setMotors':
        return r.setMotors(call.args[0], call.args[1]);
      case 'stop':
        return r.stop();
      case 'getUltrasonicDistance':
        return r.getUltrasonicDistance();
      case 'getLineFollowerValue':
        return r.getLineFollowerValue();
      case 'isLeftLineSensorOnLine':
        return r.isLeftLineSensorOnLine();
      case 'isRightLineSensorOnLine':
        return r.isRightLineSensorOnLine();
      case 'getX':
        return r.getX();
      case 'getY':
        return r.getY();
      case 'getHeading':
        return r.getHeading();
      case 'getTimer':
        return r.getTimer();
      case 'resetTimer':
        return r.resetTimer();
      case 'setRgbLed':
        return r.setRgbLed(call.args[0], call.args[1], call.args[2], call.args[3]);
      case 'displayNumber':
        return r.displayNumber(call.args[0]);
      case 'wait':
        return r.wait(call.args[0]);
      case 'yield':
        return r.yield();
      default:
        return undefined;
    }
  }
}
