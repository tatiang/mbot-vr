import { describe, expect, it } from 'vitest';
import {
  Action,
  DeviceId,
  FrameParser,
  LedIndex,
  MotorPort,
  ONBOARD_LED_PORT,
  ReplyType,
  decodeFloatLE,
  decodeInt16LE,
  decodeString,
  encodeFrame,
  encodeGet,
  encodeMotorRun,
  encodeReset,
  encodeRgbLed,
  encodeRun,
  encodeVersionGet,
  nextIndex,
} from '../src/device/MakeblockProtocol';
import { encodeAck, encodeFloatReply, encodeStringReply } from './fakeSerialLink';

describe('encodeFrame', () => {
  it('assembles header, length, index, action, device and params in order', () => {
    const frame = encodeFrame(3, Action.RUN, DeviceId.MOTOR, [9, 0x2c, 0x01]);
    // length covers index + action + device + the 3 params = 6 bytes.
    expect(Array.from(frame)).toEqual([0xff, 0x55, 6, 3, Action.RUN, DeviceId.MOTOR, 9, 0x2c, 0x01]);
  });

  it('sets the length byte to everything after itself', () => {
    const frame = encodeFrame(0, Action.GET, DeviceId.ULTRASONIC, [3]);
    // index + action + device + 1 param = 4 bytes
    expect(frame[2]).toBe(4);
    expect(frame.length).toBe(3 + frame[2]);
  });

  it('masks an out-of-range index into a single byte', () => {
    const frame = encodeFrame(300, Action.RESET, 0, []);
    expect(frame[3]).toBe(300 & 0xff);
  });
});

describe('encodeGet / encodeRun / encodeReset', () => {
  it('encodeGet uses the GET action', () => {
    const frame = encodeGet(1, DeviceId.ULTRASONIC, [3]);
    expect(frame[4]).toBe(Action.GET);
  });

  it('encodeRun uses the RUN action', () => {
    const frame = encodeRun(1, DeviceId.RGB_LED, [0, 2, 255, 0, 0]);
    expect(frame[4]).toBe(Action.RUN);
  });

  it('encodeReset carries no device or params', () => {
    const frame = encodeReset(7);
    expect(Array.from(frame)).toEqual([0xff, 0x55, 3, 7, Action.RESET, 0]);
  });

  it('encodeVersionGet targets device 0 with no port param, so it never depends on wiring', () => {
    const frame = encodeVersionGet(2);
    expect(Array.from(frame)).toEqual([0xff, 0x55, 3, 2, Action.GET, DeviceId.VERSION]);
  });
});

describe('encodeMotorRun', () => {
  // Params start at byte 6: [port, speedLo, speedHi], so the speed itself is byte 7 on.
  const speedBytes = (frame: Uint8Array) => frame.slice(7);

  it('encodes the port before the speed', () => {
    const frame = encodeMotorRun(1, MotorPort.RIGHT, 200);
    expect(frame[6]).toBe(MotorPort.RIGHT);
  });

  it('sends the right motor (M2) speed unflipped', () => {
    const frame = encodeMotorRun(1, MotorPort.RIGHT, 200);
    expect(decodeInt16LE(speedBytes(frame))).toBe(200);
  });

  it('sends a negative right-motor speed unflipped', () => {
    const frame = encodeMotorRun(1, MotorPort.RIGHT, -180);
    expect(decodeInt16LE(speedBytes(frame))).toBe(-180);
  });

  // M1 (the left motor, port 9) is physically mounted mirrored relative to M2 - see
  // the confidence note on encodeMotorRun in MakeblockProtocol.ts. Real hardware
  // testing (2 September 2026) showed this exact symptom before the fix: the left
  // wheel spun backwards on a "move forward" block.
  it('flips the left motor (M1) speed', () => {
    const frame = encodeMotorRun(1, MotorPort.LEFT, 200);
    expect(decodeInt16LE(speedBytes(frame))).toBe(-200);
  });

  it('flips a negative left-motor speed back to positive', () => {
    const frame = encodeMotorRun(1, MotorPort.LEFT, -150);
    expect(decodeInt16LE(speedBytes(frame))).toBe(150);
  });

  it('clamps speed to the runtime -255..255 range after flipping', () => {
    const high = encodeMotorRun(1, MotorPort.RIGHT, 9000);
    const low = encodeMotorRun(1, MotorPort.RIGHT, -9000);
    expect(decodeInt16LE(speedBytes(high))).toBe(255);
    expect(decodeInt16LE(speedBytes(low))).toBe(-255);
  });
});

describe('encodeRgbLed', () => {
  // Params start at byte 6: [port, slot, ledIndex, r, g, b] - six of them, not five;
  // see the confidence note on encodeRgbLed in MakeblockProtocol.ts. Real hardware
  // testing showed the earlier five-param version doing nothing at all, not just
  // lighting the wrong colour - the firmware was reading misaligned garbage.
  it('addresses the onboard LED port and strip slot, with the requested LED index', () => {
    const frame = encodeRgbLed(1, LedIndex.ALL, 10, 20, 30);
    const payload = frame.slice(6);
    expect(Array.from(payload)).toEqual([ONBOARD_LED_PORT, 2, LedIndex.ALL, 10, 20, 30]);
  });

  it('clamps each colour channel to 0-255', () => {
    const frame = encodeRgbLed(1, LedIndex.LEFT, -10, 999, 128);
    const payload = frame.slice(6);
    expect(Array.from(payload)).toEqual([ONBOARD_LED_PORT, 2, LedIndex.LEFT, 0, 255, 128]);
  });

  // Confirmed against mbot.js: runLedStrip's "all" -> 0; runLed's "led right" -> 1,
  // "led left" -> 2. An earlier version of this file had 0 = left and 2 = all.
  it.each([
    ['ALL', LedIndex.ALL, 0],
    ['RIGHT', LedIndex.RIGHT, 1],
    ['LEFT', LedIndex.LEFT, 2],
  ])('LedIndex.%s matches the official client (%i)', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe('nextIndex', () => {
  it('increments and wraps at 255', () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(254)).toBe(255);
    expect(nextIndex(255)).toBe(0);
  });
});

// FrameParser parses REPLIES (robot -> host), which - confirmed against the real
// firmware source - are NOT length-prefixed like requests are. See the confidence
// note at the top of MakeblockProtocol.ts: an earlier version of this parser assumed a
// uniform length-prefixed shape for both directions, and field-testing against a real
// mBot showed every identify attempt timing out even though the robot was replying.
describe('FrameParser', () => {
  it('extracts a bare acknowledgement (callOK) with no index', () => {
    const parser = new FrameParser();
    const frames = parser.push(encodeAck());
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBeNull();
    expect(frames[0].type).toBeNull();
    expect(frames[0].payload).toHaveLength(0);
  });

  it('extracts a FLOAT-type GET reply', () => {
    const parser = new FrameParser();
    const frames = parser.push(encodeFloatReply(5, 17.5));
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(5);
    expect(frames[0].type).toBe(ReplyType.FLOAT);
    expect(decodeFloatLE(frames[0].payload)).toBeCloseTo(17.5, 4);
  });

  it('extracts a STRING-type GET reply', () => {
    const parser = new FrameParser();
    const frames = parser.push(encodeStringReply(2, '06.01.009'));
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(2);
    expect(frames[0].type).toBe(ReplyType.STRING);
    expect(decodeString(frames[0].payload)).toBe('06.01.009');
  });

  it('assembles a reply split across two reads', () => {
    const parser = new FrameParser();
    const frame = encodeFloatReply(9, 42);
    const first = parser.push(frame.slice(0, 4));
    expect(first).toHaveLength(0);
    const second = parser.push(frame.slice(4));
    expect(second).toHaveLength(1);
    expect(second[0].index).toBe(9);
  });

  it('extracts multiple replies delivered in one chunk', () => {
    const parser = new FrameParser();
    const a = encodeAck();
    const b = encodeFloatReply(2, 1);
    const combined = new Uint8Array([...a, ...b]);
    const frames = parser.push(combined);
    expect(frames.map((f) => f.index)).toEqual([null, 2]);
  });

  it('discards garbage bytes preceding a valid header', () => {
    const parser = new FrameParser();
    const withGarbage = new Uint8Array([0x00, 0x11, 0xaa, ...encodeAck()]);
    const frames = parser.push(withGarbage);
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBeNull();
  });

  it('does not emit a frame until all of a variable-length string has arrived', () => {
    const parser = new FrameParser();
    const frame = encodeStringReply(1, 'a longer version string');
    // Header, index, type and the length byte only - none of the characters yet.
    const frames = parser.push(frame.slice(0, 5));
    expect(frames).toHaveLength(0);
  });

  it('recovers after reset() from a truncated frame left in the buffer', () => {
    const parser = new FrameParser();
    parser.push(new Uint8Array([0xff, 0x55, 3, 4])); // idx=3, type=4 (string), no length byte yet
    parser.reset();
    const frames = parser.push(encodeAck());
    expect(frames).toHaveLength(1);
  });

  it('resynchronises past an unrecognised type byte instead of hanging', () => {
    const parser = new FrameParser();
    const bogus = new Uint8Array([0xff, 0x55, 1, 0x99, 0, 0, 0x0d, 0x0a]);
    const good = encodeFloatReply(2, 3);
    const frames = parser.push(new Uint8Array([...bogus, ...good]));
    expect(frames.some((f) => f.index === 2)).toBe(true);
  });
});

describe('decodeInt16LE / decodeFloatLE', () => {
  it('decodes a positive and negative 16-bit little-endian value', () => {
    expect(decodeInt16LE(new Uint8Array([0xc8, 0x00]))).toBe(200);
    expect(decodeInt16LE(new Uint8Array([0x38, 0xff]))).toBe(-200);
  });

  it('returns 0 when there are not enough bytes rather than throwing', () => {
    expect(decodeInt16LE(new Uint8Array([0x01]))).toBe(0);
    expect(decodeFloatLE(new Uint8Array([0x01, 0x02]))).toBe(0);
  });

  it('decodes a little-endian float written by DataView', () => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, 17.5, true);
    expect(decodeFloatLE(bytes)).toBeCloseTo(17.5, 5);
  });
});

// Byte lengths per reply type, cross-checked against Makeblock's own official client
// (PacketParser.as in Makeblock-official/mBlock) rather than the firmware source alone -
// see the confidence note on `ReplyType` in MakeblockProtocol.ts for why the two
// disagree on SHORT/DOUBLE and which one this app follows.
describe('FrameParser reply type byte lengths', () => {
  it('reads a SHORT (type 3) reply as 2 data bytes, matching the official client', () => {
    const parser = new FrameParser();
    // FF 55 idx type dataLo dataHi CRLF - 8 bytes total, per PacketParser.as's splice(0, 8).
    const frame = new Uint8Array([0xff, 0x55, 7, ReplyType.SHORT, 0x2c, 0x01, 0x0d, 0x0a]);
    const [reply] = parser.push(frame);
    expect(reply.type).toBe(ReplyType.SHORT);
    expect(reply.payload).toHaveLength(2);
  });

  it('reads a DOUBLE (type 5) reply the same as FLOAT: 4 data bytes', () => {
    const floatBytes = new Uint8Array(4);
    new DataView(floatBytes.buffer).setFloat32(0, 10, true);
    const frame = new Uint8Array([0xff, 0x55, 3, ReplyType.DOUBLE, ...floatBytes, 0x0d, 0x0a]);
    const parser = new FrameParser();
    const [reply] = parser.push(frame);
    expect(reply.type).toBe(ReplyType.DOUBLE);
    expect(reply.payload).toHaveLength(4);
    expect(decodeFloatLE(reply.payload)).toBeCloseTo(10, 4);
  });

  it('reads an INT (type 6) reply as 4 data bytes', () => {
    const parser = new FrameParser();
    const frame = new Uint8Array([0xff, 0x55, 9, ReplyType.INT, 1, 0, 0, 0, 0x0d, 0x0a]);
    const [reply] = parser.push(frame);
    expect(reply.type).toBe(ReplyType.INT);
    expect(reply.payload).toHaveLength(4);
  });
});
