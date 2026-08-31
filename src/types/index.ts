/**
 * Shared domain types for mBot VR.
 *
 * All world geometry is expressed in **centimetres** with the origin at the
 * top-left corner of the arena, `x` growing to the right and `y` growing
 * downwards (the same orientation the canvas draws in, which keeps the
 * renderer free of sign flips).
 *
 * Headings are radians measured from the +x axis, growing **clockwise** on
 * screen. `utils/units.ts` converts to the friendly compass degrees students
 * see in the telemetry panel (0 deg = up, growing clockwise).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in world centimetres. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ObstacleKind = 'wall' | 'block';

export interface Obstacle extends Rect {
  id: string;
  kind: ObstacleKind;
  /** Optional override colour; playgrounds usually rely on the theme default. */
  color?: string;
}

/** A painted track a line sensor can see, stored as a polyline with a width. */
export interface LinePath {
  id: string;
  points: Vec2[];
  /** Total painted width in centimetres (mBot tape is typically ~2.5-4 cm). */
  width: number;
  /** Closed paths join the last point back to the first. */
  closed: boolean;
}

/** A non-colliding marker painted on the floor (targets, finish zones, ...). */
export interface Zone extends Rect {
  id: string;
  label?: string;
  color: string;
  /** Zones flagged as goals are what challenge checkers look at. */
  goal?: boolean;
}

export interface RobotPose {
  x: number;
  y: number;
  /** Radians, clockwise-positive from the +x axis. */
  heading: number;
}

export interface Arena {
  id: string;
  name: string;
  /** Short teacher-facing summary of what the playground practises. */
  description: string;
  widthCm: number;
  heightCm: number;
  start: RobotPose;
  obstacles: Obstacle[];
  lines: LinePath[];
  zones: Zone[];
  /** Floor tint; the renderer falls back to the theme default when omitted. */
  floorColor?: string;
  /** Grid spacing in cm, or 0 to hide the grid. */
  gridCm: number;
  /** Optional second robot for the experimental Battle Bot arena. */
  opponent?: OpponentSpec;
  /**
   * Where the parked practice opponent returns to on Reset.
   *
   * Absent until the student turns the opponent on, at which point a clear
   * spot is chosen automatically; dragging or rotating it then updates this.
   * Unrelated to {@link opponent}, which is the Battle Bot Arena's own
   * self-driving robot.
   */
  opponentStart?: RobotPose;
  /** Marks arenas the student is allowed to edit in place. */
  editable?: boolean;
}

/**
 * Declarative description of a scripted opponent. Keeping this data-only means
 * the Battle Bot arena needs no special-casing inside the engine: the engine
 * simply drives a second robot with a named behaviour.
 */
export interface OpponentSpec {
  start: RobotPose;
  behavior: 'seek' | 'patrol' | 'idle';
  /** 0-255, how hard the opponent drives. */
  power: number;
}

export type LineFollowerValue = 0 | 1 | 2 | 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Everything the UI needs to render telemetry, sampled once per frame. */
export interface RobotTelemetry {
  x: number;
  y: number;
  /** Friendly compass heading in degrees, 0-359, 0 = up. */
  headingDeg: number;
  leftMotor: number;
  rightMotor: number;
  ultrasonicCm: number;
  lineValue: LineFollowerValue;
  leftOnLine: boolean;
  rightOnLine: boolean;
  ledLeft: Rgb;
  ledRight: Rgb;
  display: string;
  /** Seconds of simulated time since the last reset. */
  clock: number;
  collided: boolean;
  distanceTravelledCm: number;
}

export type RunState = 'idle' | 'running' | 'stopping';

export interface ProjectSettings {
  /** Ultrasonic cone, rays, hit point and the measured-distance label. */
  showDistanceSensor: boolean;
  /** Line sensor dots, their on/off state, and the collision footprint. */
  showLineSensors: boolean;
  showGrid: boolean;
  speed: number;
  highlightBlocks: boolean;
  /**
   * Whether a parked practice opponent is placed in the arena. Its pose lives
   * on the arena (see {@link Arena.opponentStart}) rather than here, so that
   * moving it is saved the same way moving the player's start is. Ignored on
   * the Battle Bot Arena, which supplies its own self-driving opponent.
   */
  opponentEnabled: boolean;
  /** Mass of the student's robot in kilograms; drives pushing contests. */
  robotMassKg: number;
  /** Mass of the parked practice opponent in kilograms. */
  opponentMassKg: number;
}

export interface ProjectFile {
  version: string;
  name: string;
  playground: string;
  /** Blockly `serialization.workspaces.save` payload. */
  blockWorkspace: unknown;
  /** Only present when the project uses the editable Free Build arena. */
  customArena: Arena | null;
  settings: ProjectSettings;
  savedAt: string;
}
