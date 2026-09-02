import { describe, expect, it } from 'vitest';
import {
  Action,
  DeviceId,
  FrameParser,
  decodeFloatLE,
  decodeInt16LE,
  encodeFrame,
  encodeGet,
  encodeMotorRun,
  encodeReset,
  encodeRgbLed,
  encodeRun,
  nextIndex,
} from '../src/device/MakeblockProtocol';

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
});

describe('encodeMotorRun', () => {
  // Params start at byte 6: [port, speedLo, speedHi], so the speed itself is byte 7 on.
  const speedBytes = (frame: Uint8Array) => frame.slice(7);

  it('encodes the port before the speed', () => {
    const frame = encodeMotorRun(1, 9, 200);
    expect(frame[6]).toBe(9);
  });

  it('round-trips a positive speed through int16LE', () => {
    const frame = encodeMotorRun(1, 9, 200);
    expect(decodeInt16LE(speedBytes(frame))).toBe(200);
  });

  it('round-trips a negative speed through int16LE', () => {
    const frame = encodeMotorRun(1, 10, -180);
    expect(decodeInt16LE(speedBytes(frame))).toBe(-180);
  });

  it('clamps speed to the runtime -255..255 range', () => {
    const high = encodeMotorRun(1, 9, 9000);
    const low = encodeMotorRun(1, 9, -9000);
    expect(decodeInt16LE(speedBytes(high))).toBe(255);
    expect(decodeInt16LE(speedBytes(low))).toBe(-255);
  });
});

describe('encodeRgbLed', () => {
  it('clamps each channel to 0-255', () => {
    const frame = encodeRgbLed(1, 2, -10, 999, 128);
    // payload: [port(0), slot, r, g, b]
    const payload = frame.slice(6);
    expect(Array.from(payload)).toEqual([0, 2, 0, 255, 128]);
  });
});

describe('nextIndex', () => {
  it('increments and wraps at 255', () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(254)).toBe(255);
    expect(nextIndex(255)).toBe(0);
  });
});

describe('FrameParser', () => {
  it('extracts a single frame delivered in one chunk', () => {
    const parser = new FrameParser();
    const frame = encodeGet(5, DeviceId.ULTRASONIC, [3]);
    const frames = parser.push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(5);
    expect(Array.from(frames[0].payload)).toEqual([Action.GET, DeviceId.ULTRASONIC, 3]);
  });

  it('assembles a frame split across two reads', () => {
    const parser = new FrameParser();
    const frame = encodeMotorRun(9, 9, 100);
    const first = parser.push(frame.slice(0, 4));
    expect(first).toHaveLength(0);
    const second = parser.push(frame.slice(4));
    expect(second).toHaveLength(1);
    expect(second[0].index).toBe(9);
  });

  it('extracts multiple frames delivered in one chunk', () => {
    const parser = new FrameParser();
    const a = encodeReset(1);
    const b = encodeReset(2);
    const combined = new Uint8Array([...a, ...b]);
    const frames = parser.push(combined);
    expect(frames.map((f) => f.index)).toEqual([1, 2]);
  });

  it('discards garbage bytes preceding a valid header', () => {
    const parser = new FrameParser();
    const frame = encodeReset(4);
    const withGarbage = new Uint8Array([0x00, 0x11, 0xaa, ...frame]);
    const frames = parser.push(withGarbage);
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(4);
  });

  it('does not emit a frame until enough bytes for the declared length have arrived', () => {
    const parser = new FrameParser();
    const frame = encodeMotorRun(1, 9, 50);
    // Header + length byte only.
    const frames = parser.push(frame.slice(0, 3));
    expect(frames).toHaveLength(0);
  });

  it('recovers after reset() from a truncated frame left in the buffer', () => {
    const parser = new FrameParser();
    parser.push(new Uint8Array([0xff, 0x55, 10, 1, 2])); // claims 10 bytes, only 2 arrived
    parser.reset();
    const frame = encodeReset(9);
    const frames = parser.push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(9);
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
