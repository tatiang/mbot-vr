import type { Arena } from '../types';
import type { Robot } from './Robot';
import { resolveCollisions } from './Collision';
import { clamp } from '../utils/units';

/**
 * Contact physics for robot-against-robot pushing.
 *
 * The drive model everywhere else in the simulator is *kinematic*: a motor
 * command sets a wheel speed directly, because a geared robot at classroom
 * speeds reaches its commanded speed almost immediately. Mass therefore does
 * not change how fast a robot accelerates in open floor - it changes who wins
 * when two robots meet, which is the question students actually ask.
 *
 * The contest is decided by comparing two forces:
 *
 *   push  = min(what the motors can deliver, what the tyres can grip)
 *   hold  = how hard the other robot resists being shoved
 *
 * Capping push by grip is what makes mass matter in both directions: a
 * heavier robot presses its tyres down harder and can therefore shove more,
 * and is also harder to shove itself.
 */
export const PHYSICS = {
  gravityMS2: 9.81,

  /**
   * Peak force both motors together can deliver at full command, in newtons.
   *
   * Set above what a default-weight robot's tyres can actually grip, so that
   * at full throttle such a robot is *traction-limited*: adding weight then
   * visibly increases how hard it can push, which is the lesson here. It is
   * still a ceiling, so a robot cannot shift an opponent heavier than about
   * 5 kg no matter how much ballast it carries - real motors run out too.
   */
  motorForceMaxN: 25,

  /** Rubber tyres on a smooth classroom floor. */
  tractionCoeff: 0.7,

  /**
   * How hard a robot resists being shoved: its tyres gripping plus its
   * gearboxes refusing to backdrive.
   *
   * Deliberately close to {@link tractionCoeff}, which makes two robots of
   * similar weight a real contest. The rule it produces is easy to say out
   * loud: you can shove something up to about 1.4 times your own weight, and
   * only if you are driving hard enough - below roughly 45 out of 255 against
   * an equal-weight robot, you just stall against it.
   */
  holdCoeff: 0.5,

  /**
   * Mass of a standard mBot build with its battery pack, in kilograms.
   *
   * Approximate: Makeblock quote the assembled mBot at roughly 0.9 kg, and
   * builds vary with batteries and add-on modules, so treat this as a
   * sensible starting point rather than a specification.
   */
  defaultMassKg: 0.9,
  minMassKg: 0.2,
  maxMassKg: 10,
} as const;

/** Clamps a user-entered mass into the range the simulation behaves well over. */
export function clampMass(massKg: number): number {
  if (!Number.isFinite(massKg)) return PHYSICS.defaultMassKg;
  return clamp(massKg, PHYSICS.minMassKg, PHYSICS.maxMassKg);
}

/**
 * The most force a robot can put into a shove: motor output, capped by the
 * grip its own weight buys it.
 */
export function maxPushForceN(massKg: number, motorMagnitude: number): number {
  const motor = PHYSICS.motorForceMaxN * clamp(Math.abs(motorMagnitude) / 255, 0, 1);
  const traction = PHYSICS.tractionCoeff * massKg * PHYSICS.gravityMS2;
  return Math.min(motor, traction);
}

/** How hard this robot resists being pushed. */
export function holdForceN(massKg: number): number {
  return PHYSICS.holdCoeff * massKg * PHYSICS.gravityMS2;
}

/**
 * Force this robot is driving along the direction (nx, ny), or 0 when it is
 * driving away from it. Only the component pointing at the other robot counts,
 * so a glancing approach shoves less than a square-on one.
 */
export function pushForceAlong(robot: Robot, nx: number, ny: number): number {
  const meanMotor = (robot.leftMotor + robot.rightMotor) / 2;
  if (meanMotor === 0) return 0;

  const sign = Math.sign(meanMotor);
  const hx = Math.cos(robot.pose.heading) * sign;
  const hy = Math.sin(robot.pose.heading) * sign;
  const alignment = hx * nx + hy * ny;
  if (alignment <= 0) return 0;

  return maxPushForceN(robot.massKg, meanMotor) * alignment;
}

export interface PushOutcome {
  /** Which robot, if either, won the contest and shoved the other. */
  winner: 'a' | 'b' | null;
  aPushN: number;
  bPushN: number;
  overlapCm: number;
}

/**
 * Separates two overlapping robots, letting the stronger one shove the weaker.
 *
 * Mutates both poses. Returns what happened, which the tests assert on.
 */
export function resolveRobotPush(a: Robot, b: Robot, arena: Arena): PushOutcome | null {
  const dx = b.pose.x - a.pose.x;
  const dy = b.pose.y - a.pose.y;
  const minDist = a.radiusCm + b.radiusCm;
  let dist = Math.hypot(dx, dy);

  if (dist >= minDist) return null;

  // Exactly concentric: pick an arbitrary but stable axis to separate along.
  let nx: number;
  let ny: number;
  if (dist < 1e-6) {
    nx = 1;
    ny = 0;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  const overlap = minDist - dist;

  // `n` points from a towards b, so a shoves b along +n and b shoves a along -n.
  const aPush = pushForceAlong(a, nx, ny);
  const bPush = pushForceAlong(b, -nx, -ny);

  const massTotal = a.massKg + b.massKg;
  // Mass-weighted separation: the heavier robot gives up less ground.
  const aMassShare = b.massKg / massTotal;
  const bMassShare = a.massKg / massTotal;

  let aShare: number;
  let bShare: number;
  let winner: PushOutcome['winner'] = null;

  if (aPush > holdForceN(b.massKg) + bPush) {
    winner = 'a';
    aShare = aMassShare;
    bShare = bMassShare;
  } else if (bPush > holdForceN(a.massKg) + aPush) {
    winner = 'b';
    aShare = aMassShare;
    bShare = bMassShare;
  } else {
    // Neither can overcome the other. Whoever is actually moving caused the
    // overlap, so they absorb all of it and are simply blocked - which is
    // what makes a parked opponent immovable under a weak nudge.
    const aSpeed = Math.abs(a.lastLinearCmS);
    const bSpeed = Math.abs(b.lastLinearCmS);
    if (aSpeed > bSpeed + 0.5) {
      aShare = 1;
      bShare = 0;
    } else if (bSpeed > aSpeed + 0.5) {
      aShare = 0;
      bShare = 1;
    } else {
      aShare = aMassShare;
      bShare = bMassShare;
    }
  }

  // Move the shoved robot first, then hand any distance it could not travel
  // (because a wall stopped it) back to the pusher.
  const bBefore = { x: b.pose.x, y: b.pose.y };
  const bWanted = overlap * bShare;
  if (bWanted > 0) {
    const target = { x: b.pose.x + nx * bWanted, y: b.pose.y + ny * bWanted, heading: b.pose.heading };
    b.pose = resolveCollisions(target, b.radiusCm, arena).pose;
  }
  const bMoved = (b.pose.x - bBefore.x) * nx + (b.pose.y - bBefore.y) * ny;
  const shortfall = Math.max(0, bWanted - bMoved);

  const aWanted = overlap * aShare + shortfall;
  if (aWanted > 0) {
    const target = { x: a.pose.x - nx * aWanted, y: a.pose.y - ny * aWanted, heading: a.pose.heading };
    a.pose = resolveCollisions(target, a.radiusCm, arena).pose;
    a.collided = true;
  }
  if (bMoved > 1e-9) b.collided = true;

  return { winner, aPushN: aPush, bPushN: bPush, overlapCm: overlap };
}
