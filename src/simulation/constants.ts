/** Physical constants describing the simulated mBot chassis, in centimetres. */

export const ROBOT = {
  /** Overall chassis width (wheel to wheel outside edges). */
  widthCm: 17,
  /** Overall chassis length front to back. */
  lengthCm: 15,
  /** Collision radius - a circle is stable and forgiving for students. */
  radiusCm: 8.5,
  /** Distance from the centre to the ultrasonic sensor face. */
  ultrasonicOffsetCm: 7.5,
  /** Line sensors sit ahead of the axle, on the underside. */
  lineSensorForwardCm: 6.2,
  /** Lateral spacing of each line sensor from the centre line. */
  lineSensorSideCm: 1.6,
  /** Sensor eye radius used for the "is it over the tape" test. */
  lineSensorRadiusCm: 0.5,
} as const;

interface UltrasonicSpec {
  minRangeCm: number;
  maxRangeCm: number;
  halfAngleDeg: number;
  rayCount: number;
}

export const ULTRASONIC: UltrasonicSpec = {
  /** The HC-SR04 on an mBot is specified from about 3 cm to 400 cm. */
  minRangeCm: 3,
  maxRangeCm: 400,
  /** Half-angle of the sensing cone. Real ultrasonic beams are ~15 deg wide. */
  halfAngleDeg: 15,
  /** Rays cast across the cone; odd so one ray runs straight down the middle. */
  rayCount: 7,
};

/** Fixed physics timestep in seconds. The engine substeps to reach this. */
export const PHYSICS_STEP_S = 1 / 120;

/** Simulation speeds offered in the toolbar. */
export const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
