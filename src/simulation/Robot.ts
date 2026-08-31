import type { Arena, LineFollowerValue, RobotPose, Rgb, Vec2 } from '../types';
import { ROBOT } from './constants';
import { stepDifferentialDrive } from './DifferentialDrive';
import { resolveCollisions } from './Collision';
import { readUltrasonic, type UltrasonicReading } from './UltrasonicSensor';
import { readLineSensors } from './LineSensor';
import { formatDisplay, DISPLAY_BLANK } from './SevenSegment';
import { clampMotor, headingToCompassDeg } from '../utils/units';
import { toWorld } from '../utils/geometry';
import { PHYSICS } from './RobotPhysics';

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * One simulated mBot. The class owns pose, actuator state and cached sensor
 * readings; it deliberately knows nothing about Blockly, React or the DOM so
 * that the same object can drive a scripted opponent in the Battle Bot arena.
 */
export class Robot {
  pose: RobotPose;
  leftMotor = 0;
  rightMotor = 0;
  ledLeft: Rgb = { ...BLACK };
  ledRight: Rgb = { ...BLACK };
  display: string = DISPLAY_BLANK;
  collided = false;
  distanceTravelledCm = 0;

  /**
   * Mass in kilograms. Only affects robot-against-robot pushing contests -
   * see RobotPhysics.ts for why the drive model itself stays kinematic.
   */
  massKg: number = PHYSICS.defaultMassKg;
  /** Chassis speed from the most recent step, cm/s. Used to break push ties. */
  lastLinearCmS = 0;

  /** Cached readings, refreshed once per physics step. */
  ultrasonic: UltrasonicReading = { distanceCm: 0, rays: [], hitPoint: null };
  leftOnLine = false;
  rightOnLine = false;
  lineValue: LineFollowerValue = 3;

  readonly radiusCm = ROBOT.radiusCm;

  constructor(start: RobotPose) {
    this.pose = { ...start };
  }

  reset(start: RobotPose): void {
    this.pose = { ...start };
    this.leftMotor = 0;
    this.rightMotor = 0;
    this.ledLeft = { ...BLACK };
    this.ledRight = { ...BLACK };
    this.display = DISPLAY_BLANK;
    this.collided = false;
    this.distanceTravelledCm = 0;
    this.lastLinearCmS = 0;
    this.ultrasonic = { distanceCm: 0, rays: [], hitPoint: null };
    this.leftOnLine = false;
    this.rightOnLine = false;
    this.lineValue = 3;
  }

  setMotors(left: number, right: number): void {
    this.leftMotor = clampMotor(left);
    this.rightMotor = clampMotor(right);
  }

  stop(): void {
    this.leftMotor = 0;
    this.rightMotor = 0;
  }

  setLed(which: 'left' | 'right' | 'all', rgb: Rgb): void {
    const clamped: Rgb = {
      r: clampChannel(rgb.r),
      g: clampChannel(rgb.g),
      b: clampChannel(rgb.b),
    };
    if (which === 'left' || which === 'all') this.ledLeft = { ...clamped };
    if (which === 'right' || which === 'all') this.ledRight = { ...clamped };
  }

  displayNumber(value: number | string): void {
    this.display = formatDisplay(value);
  }

  /** World position of the ultrasonic sensor face. */
  get ultrasonicOrigin(): Vec2 {
    return toWorld(this.pose, this.pose.heading, { x: ROBOT.ultrasonicOffsetCm, y: 0 });
  }

  /** World position of the left line sensor eye. */
  get leftLineSensorPos(): Vec2 {
    return toWorld(this.pose, this.pose.heading, {
      x: ROBOT.lineSensorForwardCm,
      y: -ROBOT.lineSensorSideCm,
    });
  }

  get rightLineSensorPos(): Vec2 {
    return toWorld(this.pose, this.pose.heading, {
      x: ROBOT.lineSensorForwardCm,
      y: ROBOT.lineSensorSideCm,
    });
  }

  get headingDeg(): number {
    return headingToCompassDeg(this.pose.heading);
  }

  /**
   * Advances the robot by `dt` simulated seconds and resolves it against the
   * arena walls and obstacles.
   *
   * Deliberately does *not* handle robot-against-robot contact: that is a
   * two-body problem with masses on each side, so the engine runs it once
   * after every robot has moved (see RobotPhysics.resolveRobotPush). Sensors
   * are likewise refreshed afterwards, once every robot has settled.
   */
  integrate(dt: number, arena: Arena): void {
    const before = this.pose;
    const driven = stepDifferentialDrive(before, this.leftMotor, this.rightMotor, dt);

    const resolved = resolveCollisions(
      { x: driven.x, y: driven.y, heading: driven.heading },
      this.radiusCm,
      arena,
    );

    this.pose = resolved.pose;
    this.collided = resolved.collided;
    this.lastLinearCmS = driven.linearCmS;
    this.distanceTravelledCm += Math.hypot(this.pose.x - before.x, this.pose.y - before.y);
  }

  /**
   * Convenience for callers driving a single robot with no others around:
   * move, then refresh sensors.
   */
  step(dt: number, arena: Arena, otherRobots: Robot[] = []): void {
    this.integrate(dt, arena);
    this.refreshSensors(arena, otherRobots);
  }

  refreshSensors(arena: Arena, otherRobots: Robot[] = []): void {
    const circles = otherRobots.map((r) => ({ center: { x: r.pose.x, y: r.pose.y }, radius: r.radiusCm }));
    this.ultrasonic = readUltrasonic(this.ultrasonicOrigin, this.pose.heading, arena, circles);

    const line = readLineSensors(
      this.leftLineSensorPos,
      this.rightLineSensorPos,
      arena,
      ROBOT.lineSensorRadiusCm,
    );
    this.leftOnLine = line.leftOnLine;
    this.rightOnLine = line.rightOnLine;
    this.lineValue = line.value;
  }
}

function clampChannel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}
