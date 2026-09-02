import { describe, expect, it, vi } from 'vitest';
import { DeviceSession } from '../src/device/DeviceSession';
import { DeviceId, MotorPort } from '../src/device/MakeblockProtocol';
import { createSerialRuntime } from '../src/device/SerialRobotRuntime';
import { createFakeLink } from './fakeSerialLink';

function replyWithFloat(fake: ReturnType<typeof createFakeLink>, value: number): void {
  fake.onWrite((bytes) => {
    const idx = bytes[3];
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setFloat32(0, value, true);
    fake.emit(new Uint8Array([0xff, 0x55, 1 + payload.length, idx, ...payload]));
  });
}

describe('createSerialRuntime', () => {
  it('setMotors drives both wheels with a RUN frame each', async () => {
    const fake = createFakeLink();
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    await runtime.setMotors(120, -80);

    expect(fake.writes).toHaveLength(2);
    const [left, right] = fake.writes;
    expect(left[5]).toBe(DeviceId.MOTOR);
    expect(left[6]).toBe(MotorPort.LEFT);
    expect(right[6]).toBe(MotorPort.RIGHT);
  });

  it('stop zeroes both motors and sends a hard reset', async () => {
    const fake = createFakeLink();
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    await runtime.stop();

    expect(fake.writes).toHaveLength(3); // 2 motor writes + 1 reset
    const reset = fake.writes[2];
    expect(reset.length).toBe(6); // FF 55 len idx action device(0) - RESET carries no params
  });

  it('getUltrasonicDistance decodes the reply as a rounded float', async () => {
    const fake = createFakeLink();
    replyWithFloat(fake, 17.44);
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    const distance = await runtime.getUltrasonicDistance();

    expect(distance).toBeCloseTo(17.4, 1);
  });

  it.each([
    [0, true, true],
    [1, true, false],
    [2, false, true],
    [3, false, false],
  ])('line value %i decodes to left on-line=%s, right on-line=%s', async (raw, expectedLeft, expectedRight) => {
    const fake = createFakeLink();
    replyWithFloat(fake, raw);
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    expect(await runtime.getLineFollowerValue()).toBe(raw);
    expect(await runtime.isLeftLineSensorOnLine()).toBe(expectedLeft);
    expect(await runtime.isRightLineSensorOnLine()).toBe(expectedRight);
  });

  it('setRgbLed maps left/right/all to the correct LED slot', async () => {
    const fake = createFakeLink();
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    await runtime.setRgbLed('left', 1, 2, 3);
    await runtime.setRgbLed('right', 4, 5, 6);
    await runtime.setRgbLed('all', 7, 8, 9);

    const slots = fake.writes.map((w) => w[7]); // header(2) len idx action device port slot
    expect(slots).toEqual([0, 1, 2]);
  });

  it('getX / getY / getHeading / displayNumber reject as unsupported on hardware', async () => {
    const fake = createFakeLink();
    const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));

    await expect(runtime.getX()).rejects.toMatchObject({ code: 'ERR_PREFLIGHT_BLOCKED' });
    await expect(runtime.getY()).rejects.toMatchObject({ code: 'ERR_PREFLIGHT_BLOCKED' });
    await expect(runtime.getHeading()).rejects.toMatchObject({ code: 'ERR_PREFLIGHT_BLOCKED' });
    await expect(runtime.displayNumber(5)).rejects.toMatchObject({ code: 'ERR_PREFLIGHT_BLOCKED' });
  });

  it('resetTimer zeroes getTimer', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeLink();
      const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));
      vi.advanceTimersByTime(2500);
      expect(await runtime.getTimer()).toBeCloseTo(2.5, 1);
      await runtime.resetTimer();
      expect(await runtime.getTimer()).toBeCloseTo(0, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wait() resolves after real time has elapsed', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeLink();
      const runtime = createSerialRuntime(new DeviceSession(fake.link, 'usb'));
      const waitPromise = runtime.wait(1.5);
      let resolved = false;
      void waitPromise.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(1400);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
