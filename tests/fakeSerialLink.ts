import type { SerialLink } from '../src/device/SerialTransport';
import { Action, encodeFrame } from '../src/device/MakeblockProtocol';

/**
 * An in-memory `SerialLink` for testing `DeviceSession` and `StopController` without a
 * browser, the same way `tests/programRunner.test.ts` fakes the `Worker` global instead
 * of mocking `postMessage` calls one by one. Not a `.test.ts` file, so vitest's
 * `include: ['tests/**\/*.test.ts']` does not try to run it as a suite on its own.
 */
export interface FakeLinkController {
  link: SerialLink;
  writes: Uint8Array[];
  signalCalls: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }>;
  readonly closed: boolean;
  /** Installs the "device"'s response to each write - call `emit()` from inside to reply. */
  onWrite(handler: (bytes: Uint8Array) => void) : void;
  /** Delivers bytes to every registered `onData` handler, as if the device sent them. */
  emit(bytes: Uint8Array): void;
  /** Fires every registered `onDisconnect` handler. */
  triggerDisconnect(): void;
}

export function createFakeLink(): FakeLinkController {
  const dataHandlers = new Set<(bytes: Uint8Array) => void>();
  const disconnectHandlers = new Set<() => void>();
  const writes: Uint8Array[] = [];
  const signalCalls: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = [];
  let writeHandler: ((bytes: Uint8Array) => void) | null = null;
  let closed = false;

  const link: SerialLink = {
    async write(bytes) {
      if (closed) throw new Error('link closed');
      writes.push(bytes);
      writeHandler?.(bytes);
    },
    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
    async setSignals(signals) {
      signalCalls.push(signals);
    },
    async close() {
      closed = true;
    },
  };

  return {
    link,
    writes,
    signalCalls,
    get closed() {
      return closed;
    },
    onWrite(handler) {
      writeHandler = handler;
    },
    emit(bytes) {
      for (const handler of dataHandlers) handler(bytes);
    },
    triggerDisconnect() {
      for (const handler of disconnectHandlers) handler();
    },
  };
}

/**
 * Wires a fake link so any well-formed request frame gets an immediate, generically
 * "alive" reply echoing the same index - enough for `DeviceSession.probe`/`identify` to
 * succeed without asserting anything about payload semantics (see the confidence note
 * in `MakeblockProtocol.ts`).
 */
export function autoRespond(fake: FakeLinkController): void {
  fake.onWrite((bytes) => {
    const index = bytes[3];
    if (index === undefined) return;
    fake.emit(encodeFrame(index, Action.GET, 0, [0, 0, 0, 0]));
  });
}
