import type { LineFollowerValue } from '../types';
import type { MbotRuntime } from '../runtime/RobotRuntimeBridge';
import { decodeLineFollower } from '../simulation/LineSensor';
import type { DeviceSession } from './DeviceSession';
import { LedIndex, MotorPort, decodeFloatLE } from './MakeblockProtocol';
import { DeviceError } from './types';

/**
 * The `MbotRuntime` -> physical robot binding, mirroring
 * `RobotRuntimeBridge.ts`'s `createEngineRuntime` exactly: same interface, same
 * closure-over-a-single-dependency shape, so `ProgramRunner` and every block generator
 * work unmodified against either. See `docs/hardware-bridge-plan.md` §6 for the
 * per-method mapping this implements.
 *
 * `getX`/`getY`/`getHeading` and `displayNumber` have no physical-robot equivalent (see
 * §10's compatibility table) and reject with a clear error if reached - `preflight.ts`
 * is what should stop a program using them from ever being sent in the first place.
 */
function unsupported(blockDescription: string): Promise<never> {
  return Promise.reject(
    new DeviceError(
      'ERR_PREFLIGHT_BLOCKED',
      `${blockDescription} has no physical-robot equivalent and should have been blocked before Run.`,
    ),
  );
}

export function createSerialRuntime(session: DeviceSession): MbotRuntime {
  let runStartMs = performance.now();

  async function readLineValue(): Promise<LineFollowerValue> {
    const payload = await session.getLineFollowerPayload();
    const raw = Math.round(decodeFloatLE(payload));
    return (raw >= 0 && raw <= 3 ? raw : 3) as LineFollowerValue;
  }

  return {
    async setMotors(left, right) {
      await Promise.all([session.setMotor(MotorPort.LEFT, left), session.setMotor(MotorPort.RIGHT, right)]);
    },
    async stop() {
      await Promise.all([session.setMotor(MotorPort.LEFT, 0), session.setMotor(MotorPort.RIGHT, 0)]);
      // Belt and braces, matching the plan's mapping table - a RESET is cheap and
      // catches anything a bare motors-zero pair might miss.
      await session.hardReset();
    },

    async getUltrasonicDistance() {
      const payload = await session.getUltrasonicPayload();
      return Math.round(decodeFloatLE(payload) * 10) / 10;
    },
    async getLineFollowerValue() {
      return readLineValue();
    },
    async isLeftLineSensorOnLine() {
      return decodeLineFollower(await readLineValue()).leftOnLine;
    },
    async isRightLineSensorOnLine() {
      return decodeLineFollower(await readLineValue()).rightOnLine;
    },

    getX: () => unsupported('Robot x position'),
    getY: () => unsupported('Robot y position'),
    getHeading: () => unsupported('Robot heading'),

    async getTimer() {
      const elapsedMs = performance.now() - runStartMs;
      return Math.round(elapsedMs / 100) / 10;
    },
    async resetTimer() {
      runStartMs = performance.now();
    },

    async setRgbLed(led, r, g, b) {
      const ledIndex = led === 'left' ? LedIndex.LEFT : led === 'right' ? LedIndex.RIGHT : LedIndex.ALL;
      await session.setRgbLed(ledIndex, r, g, b);
    },
    displayNumber: () => unsupported('The four-digit display'),

    // Real seconds, not simulated ones - there is no clock to gate on hardware (see
    // the "Time gating" note in docs/hardware-bridge-plan.md §2). The consequence,
    // stated up front for students, is that timings will not match the simulator.
    async wait(seconds) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
    },
    async yield() {
      // No frame budget to respect on hardware - a program spends its "yield" time
      // actually driving instead. Left as a no-op so `forever` loops still compile
      // and run unmodified.
    },
  };
}
