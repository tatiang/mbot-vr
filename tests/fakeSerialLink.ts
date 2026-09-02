import type { SerialLink } from '../src/device/SerialTransport';

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
 * Byte-accurate reply encoders matching Makeblock's real factory firmware send
 * functions (`writeHead`/`sendFloat`/`sendString`/`callOK` in
 * `mbot_factory_firmware.ino` - see the confidence note at the top of
 * `src/device/MakeblockProtocol.ts`), for simulating the *device* side in tests. Real
 * production code never needs to encode a reply - only a real board, or a test
 * standing in for one, does that - which is why these live here rather than in
 * `src/device/MakeblockProtocol.ts`.
 */
const CRLF = [0x0d, 0x0a];

/** A bare `callOK()` acknowledgement: header immediately followed by CRLF, no index. */
export function encodeAck(): Uint8Array {
  return new Uint8Array([0xff, 0x55, ...CRLF]);
}

/** A `GET` reply carrying a `FLOAT` (type 2) value - what ultrasonic/line-follower GETs return. */
export function encodeFloatReply(index: number, value: number): Uint8Array {
  const floatBytes = new Uint8Array(4);
  new DataView(floatBytes.buffer).setFloat32(0, value, true);
  return new Uint8Array([0xff, 0x55, index & 0xff, 2, ...floatBytes, ...CRLF]);
}

/** A `GET` reply carrying a `STRING` (type 4) value - what the `VERSION` GET returns. */
export function encodeStringReply(index: number, text: string): Uint8Array {
  const chars = Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  return new Uint8Array([0xff, 0x55, index & 0xff, 4, chars.length & 0xff, ...chars, ...CRLF]);
}

/**
 * Wires a fake link so any request gets an immediate "alive" reply - a version string
 * for a `VERSION` GET (what `identify`/`probe` actually send), or a plausible float for
 * any other GET, echoing the request's own index byte (byte offset 3 in every request -
 * see `MakeblockProtocol.ts`'s request frame shape).
 */
export function autoRespond(fake: FakeLinkController, version = '06.01.009'): void {
  fake.onWrite((bytes) => {
    const index = bytes[3];
    const deviceId = bytes[5];
    if (index === undefined) return;
    if (deviceId === 0) {
      fake.emit(encodeStringReply(index, version));
    } else {
      fake.emit(encodeFloatReply(index, 0));
    }
  });
}
