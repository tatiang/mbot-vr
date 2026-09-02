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
 *  - **The request frame shape** (`FF 55 <length> <idx> <action> <device> <params...>`,
 *    where `length` covers everything from `idx` onward) and the four action codes
 *    (GET/RUN/RESET/START) and device ids used here come directly from reading
 *    `serialHandle()`/`parseData()` in the firmware source, byte offset by byte offset.
 *    High confidence.
 *  - **The reply frame shape is asymmetric with the request shape** - it carries no
 *    length byte at all. Confirmed directly from the firmware's own send functions
 *    (`writeHead`/`writeSerial`/`sendFloat`/`sendString`/`callOK`, all in
 *    `mbot_factory_firmware.ino`): a `GET` reply is
 *    `FF 55 <idx> <type> <type-specific data> \r\n` (the `\r\n` from `writeEnd()`,
 *    which is `Serial.println()`); a `RUN`/`RESET`/`START` acknowledgement
 *    (`callOK()`) is just `FF 55 \r\n` with **no index and no data at all** - meaning
 *    those cannot be correlated to a specific outgoing command, which is exactly why
 *    this app never awaits a reply to a RUN/RESET/START write (see `DeviceSession`'s
 *    "fire and forget" actuator methods). `FrameParser` below implements this shape.
 *    An earlier version of this file assumed a uniform length-prefixed reply, which
 *    field-testing against a real mBot immediately showed was wrong (every identify
 *    attempt timed out even though the robot was replying) - this rewrite is the fix.
 *  - **Type-code bytes** (1=byte, 2=float, 3=a firmware-internal "short" that is
 *    actually 4 bytes wide, 4=length-prefixed string, 5=double) come directly from
 *    `sendByte`/`sendFloat`/`sendShort`/`sendString`/`sendDouble` in the firmware
 *    source. High confidence.
 *  - The motor port numbers (`MotorPort.LEFT`/`RIGHT`) are the values conventionally
 *    used across third-party mBot protocol implementations, not yet confirmed against
 *    a specific fleet's wiring (see U3/U7 in `docs/hardware-bridge-plan.md`).
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
  /** No port, always answers, port-independent - the identify/probe target. */
  VERSION: 0,
  ULTRASONIC: 1,
  RGB_LED: 8,
  MOTOR: 10,
  SERVO: 11,
  LINE_FOLLOWER: 17,
  /** Reserved for mBot VR Player firmware EEPROM bytecode operations. */
  PLAYER: 0x7d,
} as const;

/** Subcommands for the custom Player firmware device id. */
export const PlayerCommand = {
  INFO: 0x01,
  BEGIN_PROGRAM_WRITE: 0x10,
  WRITE_PROGRAM_CHUNK: 0x11,
  COMMIT_PROGRAM: 0x12,
  VERIFY_PROGRAM: 0x13,
  SET_BOOT_IDLE: 0x20,
} as const;

/**
 * mBot motor port numbers - confirmed against `Makeblock-official/mBlock`'s own
 * `mbot.js` (`ports.M1 = 9, ports.M2 = 10`), the same client used to find the two bugs
 * these constants are now paired with: see `encodeMotorRun` below for the `M1`/port-9
 * sign flip that real hardware testing (2 September 2026) showed this app was missing.
 */
export const MotorPort = {
  LEFT: 9,
  RIGHT: 10,
} as const;

/**
 * The onboard RGB LEDs are addressed as if they were an LED strip module wired to a
 * fixed "port" - confirmed against `mbot.js`'s `runLed`, which always calls
 * `runLedStrip(7, 2, ledIndex, ...)` for the onboard LEDs. `ONBOARD_LED_PORT` and
 * `LED_STRIP_SLOT` are both constants, not configurable per call.
 */
export const ONBOARD_LED_PORT = 7;
const LED_STRIP_SLOT = 2;

/**
 * Which onboard LED(s) a `RUN` command addresses - confirmed against `mbot.js`'s
 * `runLedStrip` (`"all" -> 0`) and `runLed` (`"led right" -> 1, "led left" -> 2`).
 * An earlier version of this file had this backwards (0 = left, 2 = all), which -
 * combined with sending the wrong number of parameters entirely (see `encodeRgbLed`) -
 * is why real hardware testing showed the LED blocks doing nothing at all.
 */
export const LedIndex = {
  ALL: 0,
  RIGHT: 1,
  LEFT: 2,
} as const;

/**
 * Type-code byte a GET reply's data is tagged with (`sendByte`/`sendFloat`/etc.).
 * `BYTE`, `FLOAT` and `STRING` are the only ones this app's own device methods
 * currently produce or parse (ultrasonic/line-follower use `FLOAT`; `VERSION` uses
 * `STRING`) and are confirmed against two independent official sources: Makeblock's
 * standalone factory-firmware repo and the client+firmware pair bundled together in
 * `Makeblock-official/mBlock`. `SHORT` and `DOUBLE` are a genuine, if academic,
 * inconsistency *within Makeblock's own mBlock repo*: its bundled firmware's
 * `sendShort`/`sendDouble` write 4 and 8 bytes respectively, but its own client
 * (`PacketParser.as`) reads `SHORT` as 2 bytes and treats `DOUBLE` identically to
 * `FLOAT` (4 bytes) - and neither `sendShort` nor `sendDouble` is ever actually called
 * anywhere in that firmware, so the mismatch has evidently never mattered in practice.
 * The lengths below follow the *client's* behaviour, on the theory that a real,
 * shipped, working app is the more trustworthy source when the two disagree. `INT` (6)
 * appears only in the client's parser, with no corresponding firmware sender found;
 * included for forward compatibility.
 */
export const ReplyType = {
  BYTE: 1,
  FLOAT: 2,
  SHORT: 3,
  STRING: 4,
  DOUBLE: 5,
  INT: 6,
} as const;

const MAX_INDEX = 0xff;

/** Wraps a request index 0-255, the same range the frame's index byte can hold. */
export function nextIndex(current: number): number {
  return (current + 1) & MAX_INDEX;
}

// --- encoding (host -> robot; length-prefixed) -------------------------------------

/**
 * Assembles one request frame: `FF 55 length index action device ...params`, where
 * `length` covers everything from `index` onward. Every request-encoding helper below
 * funnels through this, so there is exactly one place that gets the framing right.
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

/** Stops both motors and the buzzer on the firmware side. Replies with a bare `callOK()`. */
export function encodeReset(index: number): Uint8Array {
  return encodeFrame(index, Action.RESET, 0, []);
}

/** The version query: no port, always answered, regardless of what's physically wired up. */
export function encodeVersionGet(index: number): Uint8Array {
  return encodeGet(index, DeviceId.VERSION, []);
}

/**
 * One motor, one speed. `speed` is clamped to the runtime's -255..255 range.
 *
 * `M1` (the left motor, port 9) is physically mounted mirrored relative to `M2`, so the
 * firmware's own notion of "positive" is inverted for that one port - confirmed against
 * `mbot.js`'s `runMotor`: `if (port == 9) { speed = -speed; }`. Real hardware testing
 * (2 September 2026) showed exactly this symptom before the fix: the left wheel spun
 * backwards on a "move forward" block while the right wheel behaved correctly.
 */
export function encodeMotorRun(index: number, port: number, speed: number): Uint8Array {
  const signed = port === MotorPort.LEFT ? -speed : speed;
  const clamped = Math.max(-255, Math.min(255, Math.round(signed)));
  return encodeRun(index, DeviceId.MOTOR, [port, ...int16LE(clamped)]);
}

/**
 * Sets the onboard RGB LED(s). `ledIndex` selects which one - see `LedIndex` above.
 *
 * The parameter list is `[port, slot, ledIndex, r, g, b]` - six params, not the five an
 * earlier version of this function sent - confirmed against `mbot.js`'s `runLedStrip`
 * (`runPackage(8, port, slot, ledIndex, red, green, blue)`, called as
 * `runLedStrip(7, 2, ledIndex, ...)` for the onboard LEDs specifically). Sending the
 * wrong parameter count misaligns every byte the firmware reads after it, which is why
 * real hardware testing showed the LED blocks doing nothing at all rather than lighting
 * the wrong colour - the firmware was reading garbage, not a merely-wrong value.
 */
export function encodeRgbLed(index: number, ledIndex: number, r: number, g: number, b: number): Uint8Array {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return encodeRun(index, DeviceId.RGB_LED, [ONBOARD_LED_PORT, LED_STRIP_SLOT, ledIndex, clamp(r), clamp(g), clamp(b)]);
}

export function encodeUltrasonicGet(index: number, port: number): Uint8Array {
  return encodeGet(index, DeviceId.ULTRASONIC, [port]);
}

export function encodeLineFollowerGet(index: number, port: number): Uint8Array {
  return encodeGet(index, DeviceId.LINE_FOLLOWER, [port]);
}

export function encodePlayerGet(index: number, command: number, params: number[] = []): Uint8Array {
  return encodeGet(index, DeviceId.PLAYER, [command, ...params]);
}

function int16LE(value: number): [number, number] {
  const v = value < 0 ? value + 0x10000 : value;
  return [v & 0xff, (v >> 8) & 0xff];
}

// --- decoding (robot -> host; NOT length-prefixed - see the confidence note above) --

/**
 * One complete, framed reply.
 *
 * `index`/`type` are `null` for a `callOK()` acknowledgement (`RUN`/`RESET`/`START`),
 * which the firmware sends with no index and no data - there is nothing to correlate
 * it to a specific outgoing write, which is why `DeviceSession` never waits for one.
 */
export interface RawFrame {
  index: number | null;
  type: number | null;
  payload: Uint8Array;
}

/** Data length in bytes for each fixed-size reply type. `STRING` is handled separately (length-prefixed). */
function fixedDataLength(type: number): number | null {
  switch (type) {
    case ReplyType.BYTE:
      return 1;
    case ReplyType.FLOAT:
      return 4;
    case ReplyType.SHORT:
      return 2; // matches the official client, not the (unreachable) firmware sender - see the confidence note above
    case ReplyType.DOUBLE:
      return 4; // ditto - the client treats DOUBLE identically to FLOAT
    case ReplyType.INT:
      return 4;
    default:
      return null;
  }
}

/**
 * Turns a byte stream of robot replies into frames.
 *
 * Serial reads arrive in arbitrary chunks - a frame can span two reads, or one read can
 * contain several. `push()` is the only entry point: feed it whatever bytes just
 * arrived, and it returns every frame that became complete as a result, in order.
 * Anything before a recognised `FF 55` header is discarded as noise.
 *
 * Two reply shapes share the `FF 55` prefix and are disambiguated by what follows it:
 *  - `FF 55 0D 0A` - a bare acknowledgement (`callOK()`); the two bytes right after the
 *    header are the `\r\n` from `writeEnd()`, with no index or data in between.
 *  - `FF 55 <idx> <type> <data...> 0D 0A` - a `GET` reply, terminated the same way.
 * An index byte that happens to equal `0x0D` immediately followed by a type byte of
 * `0x0A` would be misread as the first shape - a real but rare ambiguity inherent to
 * this firmware's own protocol, not something a smarter parser can fully resolve
 * without a stricter framing than the firmware provides.
 */
export class FrameParser {
  private buffer: number[] = [];

  push(chunk: Uint8Array): RawFrame[] {
    for (const byte of chunk) this.buffer.push(byte);
    const frames: RawFrame[] = [];
    let next = this.tryExtractOne();
    while (next !== undefined) {
      if (next) frames.push(next);
      next = this.tryExtractOne();
    }
    return frames;
  }

  /** Drops any partially-buffered bytes. Call this after a reconnect. */
  reset(): void {
    this.buffer = [];
  }

  /**
   * Returns a frame, `null` if it resynchronised past an unparseable header without
   * producing one (so the caller should immediately try again), or `undefined` if
   * nothing more can be extracted from the buffer right now.
   */
  private tryExtractOne(): RawFrame | null | undefined {
    while (
      this.buffer.length >= 2 &&
      !(this.buffer[0] === FRAME_HEADER_0 && this.buffer[1] === FRAME_HEADER_1)
    ) {
      this.buffer.shift();
    }
    if (this.buffer.length < 2) return undefined; // no header in the buffer yet
    if (this.buffer.length < 4) return undefined; // not enough to disambiguate the two shapes yet

    // Bare acknowledgement: header immediately followed by \r\n.
    if (this.buffer[2] === 0x0d && this.buffer[3] === 0x0a) {
      this.buffer.splice(0, 4);
      return { index: null, type: null, payload: new Uint8Array(0) };
    }

    const idx = this.buffer[2];
    const type = this.buffer[3];

    if (type === ReplyType.STRING) {
      if (this.buffer.length < 5) return undefined; // need the length byte
      const strLen = this.buffer[4];
      const total = 5 + strLen + 2; // header(2) + idx + type + lenByte + chars + CRLF
      if (this.buffer.length < total) return undefined;
      const bytes = this.buffer.splice(0, total);
      const payload = Uint8Array.from(bytes.slice(4, 4 + 1 + strLen));
      return { index: idx, type, payload };
    }

    const dataLen = fixedDataLength(type);
    if (dataLen === null) {
      // An unrecognised type byte - resync past just the header rather than hang
      // forever guessing a length. The bytes we drop are lost, but the parser stays
      // alive for the next real frame instead of stalling permanently.
      this.buffer.splice(0, 2);
      return null;
    }
    const total = 4 + dataLen + 2; // header(2) + idx + type + data + CRLF
    if (this.buffer.length < total) return undefined;
    const bytes = this.buffer.splice(0, total);
    const payload = Uint8Array.from(bytes.slice(4, 4 + dataLen));
    return { index: idx, type, payload };
  }
}

/** Decodes a `STRING`-type payload (`[lengthByte, ...chars]`) back into text. */
export function decodeString(payload: Uint8Array): string {
  if (payload.length < 1) return '';
  const len = payload[0];
  const chars = payload.slice(1, 1 + len);
  return String.fromCharCode(...chars);
}

/**
 * Reads a little-endian signed 16-bit value at `offset` in `bytes`. Note the firmware's
 * own `SHORT` reply type (3) is actually 4 bytes wide, not 2 - this helper is for this
 * app's own request-side encoding (motor speed), not for decoding a `SHORT` reply.
 */
export function decodeInt16LE(bytes: Uint8Array, offset = 0): number {
  if (bytes.length < offset + 2) return 0;
  const value = bytes[offset] | (bytes[offset + 1] << 8);
  return value >= 0x8000 ? value - 0x10000 : value;
}

/**
 * Reads a little-endian IEEE-754 float at `offset` in `bytes`. Used for the ultrasonic
 * and line-follower readings, both sent by the firmware as type `FLOAT` (2).
 */
export function decodeFloatLE(bytes: Uint8Array, offset = 0): number {
  if (bytes.length < offset + 4) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}
