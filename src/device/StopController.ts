import type { DeviceSession } from './DeviceSession';
import { MotorPort } from './MakeblockProtocol';
import type { StopOutcome } from './types';

/**
 * The stop escalation ladder from `docs/hardware-bridge-plan.md` §9. This is the only
 * path in the app that is allowed to report a robot as stopped - everywhere else
 * (a finished program, a disconnect, a timeout elsewhere) must call this rather than
 * assume motors are off.
 *
 * A note on "flush the write queue, don't append to it" from the plan: this app's
 * architecture never actually builds up a queue of unsent writes to flush. Every robot
 * call in a running program is awaited one at a time by `ProgramRunner` (see
 * `runtime/ProgramRunner.ts`), so by the time `stopRobot` runs, `ProgramRunner.stop()`
 * has already terminated the worker and no further program-generated command can be
 * created. At most one write may already be in flight to the port; the halt writes
 * below simply queue immediately behind it at the browser's stream-writer level, which
 * is as close to "ahead of everything else" as this architecture ever needs to get.
 */

export interface StopLogger {
  log(input: { message: string; code?: string; detail?: string; elapsedMs?: number; retryCount?: number }): void;
}

const PROBE_TIMEOUT_MS = 300;
const HALT_REPEAT_GAP_MS = 60;
const POST_RESET_WAIT_MS = 300;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort: a halt write failing just means the link is already gone. */
async function sendHalt(session: DeviceSession): Promise<void> {
  await Promise.allSettled([session.setMotor(MotorPort.LEFT, 0), session.setMotor(MotorPort.RIGHT, 0)]);
  await session.hardReset().catch(() => undefined);
}

/**
 * Runs the ladder: cut motors twice, demand a reply, and - only if that reply never
 * comes - pulse the bootloader reset line and demand a reply again. Returns
 * `'confirmed'` only when a probe actually answered after the halt; anything else is
 * `'unconfirmed'`, and the caller (`App.tsx`) is responsible for rendering that as a
 * persistent "may still be moving" state rather than a success.
 */
export async function stopRobot(session: DeviceSession, logger?: StopLogger): Promise<StopOutcome> {
  const start = performance.now();
  session.markStopping();
  logger?.log({ message: 'Stop pressed - halting motors' });

  await sendHalt(session);
  await wait(HALT_REPEAT_GAP_MS);
  await sendHalt(session);

  let confirmed = await session.probe(PROBE_TIMEOUT_MS);
  let usedResetPulse = false;

  if (!confirmed) {
    usedResetPulse = true;
    await session.pulseReset().catch(() => undefined);
    await wait(POST_RESET_WAIT_MS);
    confirmed = await session.probe(PROBE_TIMEOUT_MS);
  }

  const elapsedMs = Math.round(performance.now() - start);
  session.markStopOutcome(confirmed);

  if (confirmed) {
    logger?.log({ message: 'Robot stopped - confirmed', elapsedMs });
  } else {
    logger?.log({
      message: 'Robot did not confirm it stopped',
      code: 'ERR_STOP_UNCONFIRMED',
      detail: usedResetPulse ? 'halt + reset pulse, no reply' : 'halt, no reply',
      elapsedMs,
    });
  }

  return confirmed ? 'confirmed' : 'unconfirmed';
}
