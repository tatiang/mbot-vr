import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSession } from '../src/device/DeviceSession';
import { DeviceId } from '../src/device/MakeblockProtocol';
import { autoRespond, createFakeLink, encodeFloatReply } from './fakeSerialLink';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DeviceSession.identify', () => {
  it('moves to confirmingIdentity once a live board answers', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const statuses: string[] = [];
    const session = new DeviceSession(fake.link, 'usb', { onStatusChange: (s) => statuses.push(s.phase) });

    await session.identify();

    expect(session.getStatus().phase).toBe('confirmingIdentity');
    expect(statuses).toContain('identifying');
    expect(statuses).toContain('confirmingIdentity');
  });

  it('captures the firmware version string reported by the VERSION GET', async () => {
    const fake = createFakeLink();
    autoRespond(fake, '06.01.009');
    const session = new DeviceSession(fake.link, 'usb');

    await session.identify();

    expect(session.getProfile().firmwareVersion).toBe('06.01.009');
  });

  it('queries device 0 (VERSION), not a sensor, so identify never depends on port wiring', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');

    await session.identify();

    const request = fake.writes[0];
    expect(request[5]).toBe(DeviceId.VERSION);
  });

  it('rejects with ERR_NO_REPLY after 3 silent attempts', async () => {
    const fake = createFakeLink(); // no autoRespond - the "device" never answers
    const session = new DeviceSession(fake.link, 'usb');

    const identifyPromise = session.identify();
    // Attach a handler in the same tick the promise is created, so Node never sees a
    // turn where this rejection is unhandled - the real assertion still runs below via
    // the same promise reference, since a promise may have more than one handler.
    const outcome = identifyPromise.then(
      () => ({ rejected: false as const }),
      (error: unknown) => ({ rejected: true as const, error }),
    );
    // Let the 3 attempts (2000ms each) and 2 gaps (400ms each) fully elapse.
    await vi.advanceTimersByTimeAsync(2000 * 3 + 400 * 2 + 10);

    const result = await outcome;
    expect(result.rejected).toBe(true);
    if (result.rejected) expect(result.error).toMatchObject({ code: 'ERR_NO_REPLY' });
    expect(session.getStatus().phase).toBe('error');
  });

  it('gives every GET frame during identify a distinct index', async () => {
    const fake = createFakeLink();
    const seenIndexes: number[] = [];
    fake.onWrite((bytes) => seenIndexes.push(bytes[3]));
    const session = new DeviceSession(fake.link, 'usb');

    const identifyPromise = session.identify();
    const settled = identifyPromise.catch(() => undefined); // attach immediately, see above
    await vi.advanceTimersByTimeAsync(2000 * 3 + 400 * 2 + 10);
    await settled;

    expect(new Set(seenIndexes).size).toBe(seenIndexes.length);
  });
});

describe('DeviceSession identity confirmation', () => {
  it('confirmIdentity moves confirmingIdentity -> ready', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();

    session.confirmIdentity();

    expect(session.getStatus().phase).toBe('ready');
    expect(session.isIdentityConfirmed()).toBe(true);
  });

  it('confirmIdentity is a no-op outside confirmingIdentity', () => {
    const fake = createFakeLink();
    const session = new DeviceSession(fake.link, 'usb');
    session.confirmIdentity();
    expect(session.getStatus().phase).not.toBe('ready');
    expect(session.isIdentityConfirmed()).toBe(false);
  });

  it('acknowledgeStopUnconfirmed clears the sticky warning back to ready', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();
    session.confirmIdentity();
    session.markStopping();
    session.markStopOutcome(false); // simulate the ladder failing to confirm

    expect(session.getStatus().phase).toBe('stopUnconfirmed');
    session.acknowledgeStopUnconfirmed();
    expect(session.getStatus().phase).toBe('ready');
  });

  it('acknowledgeStopUnconfirmed is a no-op outside stopUnconfirmed', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();
    session.confirmIdentity();

    session.acknowledgeStopUnconfirmed();

    expect(session.getStatus().phase).toBe('ready');
  });

  it('rejectIdentity returns to disconnected and closes the link', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();

    session.rejectIdentity();

    expect(session.getStatus().phase).toBe('disconnected');
    expect(session.isIdentityConfirmed()).toBe(false);
    expect(fake.closed).toBe(true);
  });
});

describe('DeviceSession sensors', () => {
  it('getUltrasonicPayload requests the configured default port', async () => {
    const fake = createFakeLink();
    autoRespond(fake);
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();
    session.confirmIdentity();

    await session.getUltrasonicPayload();

    const request = fake.writes[fake.writes.length - 1];
    // header(2) len(1) idx(1) action(1) device(1) port(1)
    expect(request[5]).toBe(DeviceId.ULTRASONIC);
    expect(request[6]).toBe(3); // default ultrasonic port
  });

  it('retries a read up to twice before giving up', async () => {
    const fake = createFakeLink();
    let writeCount = 0;
    fake.onWrite(() => {
      writeCount += 1;
      // Never reply - forces every attempt to time out.
    });
    const session = new DeviceSession(fake.link, 'usb');

    const promise = session.getUltrasonicPayload();
    const settled = promise.then(
      () => ({ rejected: false as const }),
      (error: unknown) => ({ rejected: true as const, error }),
    );
    await vi.advanceTimersByTimeAsync(400 * 3 + 10);
    const result = await settled;

    expect(result.rejected).toBe(true);
    expect(writeCount).toBe(3); // 1 attempt + 2 retries
  });

  it('succeeds if a reply arrives on the second attempt', async () => {
    const fake = createFakeLink();
    let attempt = 0;
    fake.onWrite((bytes) => {
      attempt += 1;
      if (attempt >= 2) {
        fake.emit(encodeFloatReply(bytes[3], 12.5));
      }
    });
    const session = new DeviceSession(fake.link, 'usb');

    const promise = session.getUltrasonicPayload();
    await vi.advanceTimersByTimeAsync(400 + 10);
    const payload = await promise;

    expect(payload).toBeInstanceOf(Uint8Array);
    expect(attempt).toBe(2);
  });
});

describe('DeviceSession disconnect handling', () => {
  it('rejects pending requests and moves to linkLost', async () => {
    const fake = createFakeLink(); // no reply
    const session = new DeviceSession(fake.link, 'usb');

    const promise = session.probe(5000);
    fake.triggerDisconnect();

    await expect(promise.then(() => 'resolved')).resolves.toBe('resolved');
    // probe() swallows the error and resolves false rather than throwing.
    expect(await promise).toBe(false);
    expect(session.getStatus().phase).toBe('linkLost');
  });
});

describe('DeviceSession actuators', () => {
  it('setMotor encodes a RUN frame to the motor device', async () => {
    const fake = createFakeLink();
    const session = new DeviceSession(fake.link, 'usb');
    await session.setMotor(9, 120);
    const frame = fake.writes[0];
    expect(frame[5]).toBe(DeviceId.MOTOR);
    expect(frame[6]).toBe(9);
  });

  it('hardReset sends a RESET frame with no device byte params', async () => {
    const fake = createFakeLink();
    const session = new DeviceSession(fake.link, 'usb');
    await session.hardReset();
    const frame = fake.writes[0];
    expect(frame.length).toBe(6); // FF 55 len idx action device(0)
  });

  it('pulseReset toggles DTR high then low', async () => {
    const fake = createFakeLink();
    const session = new DeviceSession(fake.link, 'usb');
    const promise = session.pulseReset();
    await vi.advanceTimersByTimeAsync(60);
    await promise;
    expect(fake.signalCalls).toEqual([{ dataTerminalReady: true }, { dataTerminalReady: false }]);
  });

  it('wink never throws even if every write fails', async () => {
    const fake = createFakeLink();
    fake.link.write = async () => {
      throw new Error('gone');
    };
    const session = new DeviceSession(fake.link, 'usb');
    const promise = session.wink();
    await vi.advanceTimersByTimeAsync(150 * 4 + 10);
    await expect(promise).resolves.toBeUndefined();
  });
});
