/**
 * Unit helpers. Students only ever see centimetres, degrees and motor values;
 * pixels exist solely inside the renderer, and these functions are the only
 * sanctioned bridge between the two.
 */

/** Motor commands are the mBot's native -255..255 range. */
export const MOTOR_MAX = 255;

/**
 * Wheel surface speed in cm/s at motor value 255. Tuned so the classic
 * "drive a square" recipe (turn at 130 for 0.45 s) lands within a couple of
 * degrees of a true 90 deg corner, matching a real mBot on a smooth floor.
 */
export const MAX_WHEEL_SPEED_CM_S = 40;

/** Distance between the two wheel contact patches, in cm (mBot chassis). */
export const WHEEL_TRACK_CM = 11.5;

export function clampMotor(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MOTOR_MAX, Math.min(MOTOR_MAX, Math.round(value)));
}

/** Converts a -255..255 motor command into a wheel speed in cm/s. */
export function motorToWheelSpeed(motor: number): number {
  return (clampMotor(motor) / MOTOR_MAX) * MAX_WHEEL_SPEED_CM_S;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Converts an internal heading (radians, 0 = +x/right, clockwise-positive)
 * into the compass-style degrees shown to students: 0 = up, 90 = right.
 */
export function headingToCompassDeg(heading: number): number {
  const deg = radToDeg(heading) + 90;
  return ((deg % 360) + 360) % 360;
}

/** Inverse of {@link headingToCompassDeg}, used by arena definitions. */
export function compassDegToHeading(deg: number): number {
  return degToRad(deg - 90);
}

/** Wraps an angle into (-PI, PI]. */
export function normalizeAngle(rad: number): number {
  let a = rad;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** Rounds to a fixed number of decimals without string round-tripping. */
export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
