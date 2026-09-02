/**
 * The Makeblock mCore serial protocol: `0xFF 0x55` framed commands, exactly as
 * implemented in Makeblock's own open-source factory firmware for mBot v1
 * (`mbot_factory_firmware.ino`, GPLv2, Makeblock-Libraries repo - see
 * `docs/hardware-bridge-plan.md` §3, source 13). This module only encodes bytes and
 * parses byte streams; it knows nothing about serial ports, timeouts or retries - that
 * lives in `DeviceSession.ts`, which is what makes this file testable with plain
 * arrays of numbers and nothing else.
 *
 * Confidence levels, so a future change knows what to trust:
 *  - Frame shape (header, length byte, index byte) and the four action codes
 *    (GET/RUN/RESET/START) and device ids used here come directly from reading the
 *    firmware source. High confidence.
 *  - The exact byte layout Makeblock's firmware uses for a *reply* (which value-type
 *    byte precedes which kind of payload) was not confirmed against a byte capture
 *    from real hardware - the research for this feature could not reach a physical
 *    mBot. `decodeFloatLE`/`decodeInt16LE` below are reasonable, commonly-used
 *    encodings for an AVR firmware, but they are a best effort pending the phase-0
 *    spike in `docs/hardware-bridge-plan.md` §4 (U2/U6). `FrameParser` itself does not
 *    depend on this: it only needs the header and length byte to find frame
 *    boundaries, which is true regardless of how the payload is interpreted.
 *  - The motor port numbers (`MotorPort.LEFT`/`RIGHT`) are the values conventionally
 *    used across third-party mBot protocol implementations, not confirmed against this
 *    fleet's wiring (U3/U7).
 */

export const FRAME_HEADER_0 = 0xff;
export const FRAME_HEADER_1 = 0x55;

/** Action byte, per the firmware's own dispatch switch. */
export const Action = {
  GET: 1,
  RUN: 2,
  RESET: 4,
  START: 5,
} as const;
export type ActionCode = (typeof Action)[keyof typeof Action];

/** Device id byte, for the devices this app's block set actually needs. */
export const DeviceId = {
  ULTRASONIC: 1,
  RGB_LED: 8,
  MOTOR: 10,
  SERVO: 11,
  LINE_FOLLOWER: 17,
} as const;

/** Conventional mBot motor port numbers. See the confidence note above. */
export const MotorPort = {
  LEFT: 9,
  RIGHT: 10,
} as const;

/** RGB LED "slot" the firmware's RUN command expects: 0 = left, 1 = right, 2 = both. */
export const LedSlot = {
  LEFT: 0,
  RIGHT: 1,
  ALL: 2,
} as const;

const MAX_INDEX = 0xff;

/** Wraps a request index 0-255, the same range the frame's index byte can hold. */
export function nextIndex(current: number): number {
  return (current + 1) & MAX_INDEX;
}

// --- encoding ---------------------------------------------------------------------

/**
 * Assembles one frame: `FF 55 length index action device ...params`, where `length`
 * covers everything from `index` onward. Every request-encoding helper below funnels
 * through this, so there is exactly one place that gets the framing right.
 */
export function encodeFrame(index: number, action: ActionCode, deviceId: number, params: number[]): Uint8Array {
  const body = [index & 0xff, action, deviceId & 0xff, ...params.map((b) => b & 0xff)];
  return new Uint8Array([FRAME_HEADER_0, FRAME_HEADER_1, body.length & 0xff, ...body]);
}

export function encodeGet(index: number, deviceId: number, params: number[] = []): Uint8Array {
  return encodeFrame(index, Action.GET, deviceId, params);
}

export function encodeRun(index: number, deviceId: number, params: number[] = []): Uint8Array {
  return encodeFrame(index, Action.RUN, deviceId, params);
}

/** Stops both motors and the buzzer on the firmware side - see the confidence note above. */
export function encodeReset(index: number): Uint8Array {
  return encodeFrame(index, Action.RESET, 0, []);
}

/** One motor, one speed. `speed` is clamped to the runtime's -255..255 range. */
export function encodeMotorRun(index: number, port: number, speed: number): Uint8Array {
  const clamped = Math.max(-255, Math.min(255, Math.round(speed)));
  return encodeRun(index, DeviceId.MOTOR, [port, ...int16LE(clamped)]);
}

export function encodeRgbLed(index: number, slot: number, r: number, g: number, b: number): Uint8Array {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  // Port 0: the onboard LEDs are wired directly to the board, not to an RJ25 port.
  return encodeRun(index, DeviceId.RGB_LED, [0, slot, clamp(r), clamp(g), clamp(b)]);
}

export function encodeUltrasonicGet(index: number, port: number): Uint8Array {
  return encodeGet(index, DeviceId.ULTRASONIC, [port]);
}

export function encodeLineFollowerGet(index: number, port: number): Uint8Array {
  return encodeGet(index, DeviceId.LINE_FOLLOWER, [port]);
}

function int16LE(value: number): [number, number] {
  const v = value < 0 ? value + 0x10000 : value;
  return [v & 0xff, (v >> 8) & 0xff];
}

// --- decoding ---------------------------------------------------------------------

/** One complete, framed reply: the echoed index, and everything after it, uninterpreted. */
export interface RawFrame {
  index: number;
  payload: Uint8Array;
}

/**
 * Turns a byte stream into frames.
 *
 * Serial reads arrive in arbitrary chunks - a frame can span two reads, or one read can
 * contain several frames. `push()` is the only entry point: feed it whatever bytes just
 * arrived, and it returns every frame that became complete as a result, in order.
 * Anything before a recognised `FF 55` header is discarded as noise (a partial frame
 * left over from a reset, or line-startup garbage) rather than left to jam the parser.
 */
export class FrameParser {
  private buffer: number[] = [];

  push(chunk: Uint8Array): RawFrame[] {
    for (const byte of chunk) this.buffer.push(byte);
    const frames: RawFrame[] = [];
    let next = this.tryExtractOne();
    while (next) {
      frames.push(next);
      next = this.tryExtractOne();
    }
    return frames;
  }

  /** Drops any partially-buffered bytes. Call this after a reconnect. */
  reset(): void {
    this.buffer = [];
  }

  private tryExtractOne(): RawFrame | null {
    while (
      this.buffer.length >= 2 &&
      !(this.buffer[0] === FRAME_HEADER_0 && this.buffer[1] === FRAME_HEADER_1)
    ) {
      this.buffer.shift();
    }
    if (this.buffer.length < 3) return null; // header + length byte not fully in yet
    const length = this.buffer[2];
    const total = 3 + length;
    if (this.buffer.length < total) return null; // frame not fully arrived yet
    const bytes = this.buffer.splice(0, total);
    const index = bytes[3];
    const payload = Uint8Array.from(bytes.slice(4));
    return { index, payload };
  }
}

/**
 * Reads a little-endian signed 16-bit value at `offset` in `bytes`. Used for motor
 * speed echoes and any short-typed sensor reply. See the confidence note at the top of
 * this file.
 */
export function decodeInt16LE(bytes: Uint8Array, offset = 0): number {
  if (bytes.length < offset + 2) return 0;
  const value = bytes[offset] | (bytes[offset + 1] << 8);
  return value >= 0x8000 ? value - 0x10000 : value;
}

/**
 * Reads a little-endian IEEE-754 float at `offset` in `bytes`. Used for the ultrasonic
 * and line-follower readings. See the confidence note at the top of this file.
 */
export function decodeFloatLE(bytes: Uint8Array, offset = 0): number {
  if (bytes.length < offset + 4) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}
