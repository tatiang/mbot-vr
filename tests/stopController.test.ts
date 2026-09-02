import { describe, expect, it } from 'vitest';
import { DeviceSession } from '../src/device/DeviceSession';
import { DeviceId, MotorPort } from '../src/device/MakeblockProtocol';
import { stopRobot } from '../src/device/StopController';
import { autoRespond, createFakeLink } from './fakeSerialLink';

// Deliberately real timers, not fake ones: the stop ladder's own gaps (60ms, 300ms) are
// small enough that these tests run in well under a second, and the ladder's timing
// interacts with itself across several async branches in a way that is easy to get
// subtly wrong when driving it by hand with fake-timer advancement.

/** A ready DeviceSession, identified and confirmed, so status transitions are observable. */
async function readySession(fake: ReturnType<typeof createFakeLink>): Promise<DeviceSession> {
  autoRespond(fake);
  const session = new DeviceSession(fake.link, 'usb');
  await session.identify();
  session.confirmIdentity();
  fake.writes.length = 0; // ignore identify's own traffic in assertions below
  return session;
}

describe('stopRobot', () => {
  it('confirms the stop when the robot answers the post-halt probe', async () => {
    const fake = createFakeLink();
    const session = await readySession(fake);

    const outcome = await stopRobot(session);

    expect(outcome).toBe('confirmed');
    expect(session.getStatus().phase).toBe('ready');
  });

  it('zeroes both motors and sends a reset before ever probing', async () => {
    const fake = createFakeLink();
    const session = await readySession(fake);

    await stopRobot(session);

    // First 3 writes of the halt phase: left motor 0, right motor 0, reset - repeated
    // twice, so the sequence should start with that pattern.
    expect(fake.writes[0][5]).toBe(DeviceId.MOTOR);
    expect(fake.writes[0][6]).toBe(MotorPort.LEFT);
    expect(fake.writes[1][5]).toBe(DeviceId.MOTOR);
    expect(fake.writes[1][6]).toBe(MotorPort.RIGHT);
    expect(fake.writes[2][4]).toBe(4); // Action.RESET
  });

  it('sends the halt frames twice', async () => {
    const fake = createFakeLink();
    const session = await readySession(fake);

    await stopRobot(session);

    const resetWrites = fake.writes.filter((w) => w[4] === 4);
    expect(resetWrites.length).toBeGreaterThanOrEqual(2);
  });

  it('escalates to a DTR reset pulse when the first probe gets no reply, then confirms', async () => {
    const fake = createFakeLink();
    autoRespond(fake); // will be swapped mid-test
    const session = new DeviceSession(fake.link, 'usb');
    await session.identify();
    session.confirmIdentity();
    fake.writes.length = 0;

    let probesAnswered = 0;
    fake.onWrite((bytes) => {
      const idx = bytes[3];
      if (bytes[4] === 1) {
        // A GET (probe) - only answer from the second one onward, simulating the
        // board needing the reset pulse to come back to life.
        probesAnswered += 1;
        if (probesAnswered >= 2) {
          fake.emit(new Uint8Array([0xff, 0x55, 5, idx, 1, 0, 0, 0]));
        }
      }
      // RUN/RESET frames (halt commands) get no reply either way - matching the
      // real firmware, which does not ack actuator commands.
    });

    const outcome = await stopRobot(session);

    expect(outcome).toBe('confirmed');
    expect(fake.signalCalls).toEqual([{ dataTerminalReady: true }, { dataTerminalReady: false }]);
  });

  it('reports unconfirmed and a sticky status when nothing ever answers', async () => {
    const fake = createFakeLink();
    const session = await readySession(fake); // identified and confirmed while the link still worked
    fake.onWrite(() => undefined); // the robot has now gone silent for good

    const outcome = await stopRobot(session);

    expect(outcome).toBe('unconfirmed');
    expect(session.getStatus().phase).toBe('stopUnconfirmed');
  });

  it('logs the outcome through the provided logger', async () => {
    const fake = createFakeLink();
    const session = await readySession(fake);
    const events: string[] = [];
    const logger = { log: (e: { message: string }) => events.push(e.message) };

    await stopRobot(session, logger);

    expect(events.some((m) => m.includes('Stop pressed'))).toBe(true);
    expect(events.some((m) => m.includes('confirmed'))).toBe(true);
  });
});
