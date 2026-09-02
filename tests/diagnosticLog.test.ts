import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticLog } from '../src/diagnostics/DiagnosticLog';
import { DeviceError } from '../src/device/types';

/**
 * Minimal sessionStorage stand-in so the log can be tested under Node, matching the
 * pattern `tests/projectStore.test.ts` uses for `localStorage`.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const storage = new MemoryStorage();
globalThis.sessionStorage = storage;

beforeEach(() => {
  storage.clear();
});

describe('DiagnosticLog', () => {
  it('records an event and notifies subscribers', () => {
    const log = new DiagnosticLog('1.2.0');
    const listener = vi.fn();
    log.subscribe(listener);

    log.log({ message: 'connecting' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.getEvents()).toHaveLength(1);
    expect(log.getEvents()[0].message).toBe('connecting');
  });

  it('assigns increasing ids', () => {
    const log = new DiagnosticLog('1.2.0');
    log.log({ message: 'a' });
    log.log({ message: 'b' });
    const [a, b] = log.getEvents();
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('redacts message and detail before storing', () => {
    const log = new DiagnosticLog('1.2.0');
    log.log({ message: 'opened /Users/tatiang/robot.hex', detail: 'via COM7' });
    const [event] = log.getEvents();
    expect(event.message).not.toContain('tatiang');
    expect(event.detail).not.toContain('COM7');
  });

  it('logError classifies through the taxonomy and redacts the raw message', () => {
    const log = new DiagnosticLog('1.2.0');
    log.logError('stop failed', new DeviceError('ERR_NO_REPLY', 'no reply from /dev/tty.usbserial-1420'));
    const [event] = log.getEvents();
    expect(event.code).toBe('ERR_NO_REPLY');
    expect(event.category).toBe('handshake');
    expect(event.suggestedAction).toBeTruthy();
    expect(event.detail).not.toContain('usbserial');
  });

  it('caps stored events at 500 and tracks how many were dropped', () => {
    const log = new DiagnosticLog('1.2.0');
    for (let i = 0; i < 520; i += 1) log.log({ message: `event ${i}` });
    expect(log.getEvents()).toHaveLength(500);
    expect(log.getDroppedCount()).toBe(20);
    // The oldest events are the ones dropped, not the newest.
    expect(log.getEvents()[0].message).toBe('event 20');
    expect(log.getEvents()[499].message).toBe('event 519');
  });

  it('clear() empties the log and resets the dropped counter', () => {
    const log = new DiagnosticLog('1.2.0');
    log.log({ message: 'one' });
    log.clear();
    expect(log.getEvents()).toHaveLength(0);
    expect(log.getDroppedCount()).toBe(0);
  });

  it('unsubscribe stops further notifications', () => {
    const log = new DiagnosticLog('1.2.0');
    const listener = vi.fn();
    const unsubscribe = log.subscribe(listener);
    unsubscribe();
    log.log({ message: 'after unsubscribe' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('restores events from sessionStorage on construction', async () => {
    vi.useFakeTimers();
    const first = new DiagnosticLog('1.2.0');
    first.log({ message: 'persisted' });
    await vi.advanceTimersByTimeAsync(400); // let the debounced persist fire
    vi.useRealTimers();

    const second = new DiagnosticLog('1.2.0');
    expect(second.getEvents().map((e) => e.message)).toContain('persisted');
  });

  it('never throws when sessionStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(() => {
        const log = new DiagnosticLog('1.2.0');
        log.log({ message: 'still works' });
      }).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: storage });
    }
  });
});
