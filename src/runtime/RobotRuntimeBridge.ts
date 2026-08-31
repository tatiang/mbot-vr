import type { LineFollowerValue } from '../types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import { headingToCompassDeg } from '../utils/units';

/**
 * The robot API, exactly as a program sees it.
 *
 * Blockly is only one possible front end. Anything that can produce calls
 * against this interface - a JavaScript editor, a lesson script, a future
 * Python transpiler - can drive the simulator without touching it directly.
 */
export interface MbotRuntime {
  setMotors(left: number, right: number): Promise<void>;
  stop(): Promise<void>;

  getUltrasonicDistance(): Promise<number>;
  getLineFollowerValue(): Promise<LineFollowerValue>;
  isLeftLineSensorOnLine(): Promise<boolean>;
  isRightLineSensorOnLine(): Promise<boolean>;

  getX(): Promise<number>;
  getY(): Promise<number>;
  getHeading(): Promise<number>;
  getTimer(): Promise<number>;
  /** Sets the timer back to 0, without touching pose, motors or the display. */
  resetTimer(): Promise<void>;

  setRgbLed(led: 'left' | 'right' | 'all', r: number, g: number, b: number): Promise<void>;
  displayNumber(value: number | string): Promise<void>;

  wait(ms: number): Promise<void>;
  /** One scheduling slot; used at the top of every loop iteration. */
  yield(): Promise<void>;
}

/**
 * Binds the runtime interface to a live {@link SimulationEngine}.
 *
 * Every method routes through `engine.nextSlot()` first, which is the
 * rate-limiter that stops a tight control loop from starving rendering.
 */
export function createEngineRuntime(engine: SimulationEngine): MbotRuntime {
  return {
    async setMotors(left, right) {
      await engine.nextSlot();
      engine.robot.setMotors(left, right);
    },
    async stop() {
      await engine.nextSlot();
      engine.robot.stop();
    },
    async getUltrasonicDistance() {
      await engine.nextSlot();
      return Math.round(engine.robot.ultrasonic.distanceCm * 10) / 10;
    },
    async getLineFollowerValue() {
      await engine.nextSlot();
      return engine.robot.lineValue;
    },
    async isLeftLineSensorOnLine() {
      await engine.nextSlot();
      return engine.robot.leftOnLine;
    },
    async isRightLineSensorOnLine() {
      await engine.nextSlot();
      return engine.robot.rightOnLine;
    },
    async getX() {
      await engine.nextSlot();
      return Math.round(engine.robot.pose.x * 10) / 10;
    },
    async getY() {
      await engine.nextSlot();
      return Math.round(engine.robot.pose.y * 10) / 10;
    },
    async getHeading() {
      await engine.nextSlot();
      return Math.round(headingToCompassDeg(engine.robot.pose.heading));
    },
    async getTimer() {
      await engine.nextSlot();
      return Math.round(engine.clock * 10) / 10;
    },
    async resetTimer() {
      await engine.nextSlot();
      engine.resetTimer();
    },
    async setRgbLed(led, r, g, b) {
      await engine.nextSlot();
      engine.robot.setLed(led, { r, g, b });
    },
    async displayNumber(value) {
      await engine.nextSlot();
      engine.robot.displayNumber(value);
    },
    /** `seconds`, resolved against simulated time so the speed control applies. */
    async wait(seconds) {
      await engine.wait(seconds);
    },
    async yield() {
      await engine.yieldTick();
    },
  };
}
