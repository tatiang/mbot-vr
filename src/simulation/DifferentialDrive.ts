import type { RobotPose } from '../types';
import { MAX_WHEEL_SPEED_CM_S, WHEEL_TRACK_CM, clampMotor, motorToWheelSpeed } from '../utils/units';

export interface DriveResult extends RobotPose {
  /** Forward speed of the chassis centre, cm/s. */
  linearCmS: number;
  /** Angular speed, rad/s, clockwise-positive on screen. */
  angularRadS: number;
}

/**
 * Exact integration of the differential-drive kinematic model.
 *
 * Using the closed-form arc solution rather than Euler steps means a curved
 * turn traces a true circle no matter how large the timestep is, so students
 * get the same shape at 0.5x and 4x simulation speed.
 */
export function stepDifferentialDrive(
  pose: RobotPose,
  leftMotor: number,
  rightMotor: number,
  dt: number,
): DriveResult {
  const vL = motorToWheelSpeed(leftMotor);
  const vR = motorToWheelSpeed(rightMotor);

  // Chassis speed is the mean of the wheels; rotation comes from their
  // difference. Left faster than right turns the robot clockwise on screen,
  // which reads as a right turn to the student.
  const linear = (vL + vR) / 2;
  const angular = (vL - vR) / WHEEL_TRACK_CM;

  let { x, y, heading } = pose;

  if (Math.abs(angular) < 1e-9) {
    // Straight line.
    x += Math.cos(heading) * linear * dt;
    y += Math.sin(heading) * linear * dt;
  } else {
    // Arc of radius linear/angular about the instantaneous centre of curvature.
    const radius = linear / angular;
    const newHeading = heading + angular * dt;
    x += radius * (Math.sin(newHeading) - Math.sin(heading));
    y -= radius * (Math.cos(newHeading) - Math.cos(heading));
    heading = newHeading;
  }

  return { x, y, heading, linearCmS: linear, angularRadS: angular };
}

/** Peak chassis speed, used by the UI to describe motor values to students. */
export function maxLinearSpeedCmS(): number {
  return MAX_WHEEL_SPEED_CM_S;
}

/** Normalises a pair of raw block inputs into safe motor commands. */
export function sanitizeMotors(left: number, right: number): [number, number] {
  return [clampMotor(left), clampMotor(right)];
}
