import type { SimulationEngine } from '../simulation/SimulationEngine';
import type { Vec2 } from '../types';

/**
 * Everything a challenge might want to ask about a run. The tracker keeps this
 * updated from the physics loop so challenge rules stay pure functions.
 */
export interface ChallengeStats {
  /** Simulated seconds since the run began. */
  elapsed: number;
  /** Number of distinct bump events (rising edges, not frames touching). */
  collisions: number;
  distanceTravelledCm: number;
  /** Simulated seconds with at least one line sensor over the tape. */
  onLineSeconds: number;
  /** Consecutive simulated seconds with both sensors off the tape. */
  currentOffLineSeconds: number;
  longestOffLineSeconds: number;
  maxDistanceFromStartCm: number;
  distanceFromStartCm: number;
  /** Ids of goal zones the robot has entered during this run. */
  visitedGoalZones: string[];
  /** True once the robot left the start area and came back to it. */
  returnedToStart: boolean;
  /** Completed laps of the arena's closed line course. */
  laps: number;
  /** Fraction (0-1) of the current lap completed. */
  lapProgress: number;
}

/** How close counts as "back at the start". */
const START_RADIUS_CM = 15;
/**
 * How far the robot must get before returning counts for anything.
 *
 * Sized against the smallest interesting trip: the "drive a square" example
 * traces roughly 22 cm sides, which peaks about 31 cm from the start marker.
 */
const LEFT_START_RADIUS_CM = 25;
const CHECKPOINT_COUNT = 12;
const CHECKPOINT_RADIUS_CM = 22;

/**
 * Watches a run and accumulates the statistics challenges are scored on.
 *
 * Sampling lives in the physics loop rather than in React so that a fast
 * simulation speed cannot let the robot tunnel past a checkpoint between
 * renders.
 */
export class ChallengeTracker {
  stats: ChallengeStats = emptyStats();

  private wasColliding = false;
  private hasLeftStart = false;
  private checkpoints: Vec2[] = [];
  private nextCheckpoint = 0;
  private checkpointsHit = 0;
  private arenaIdForCheckpoints: string | null = null;

  reset(): void {
    this.stats = emptyStats();
    this.wasColliding = false;
    this.hasLeftStart = false;
    this.nextCheckpoint = 0;
    this.checkpointsHit = 0;
  }

  sample(engine: SimulationEngine, dt: number): void {
    const { robot, arena } = engine;
    const s = this.stats;

    s.elapsed += dt;
    s.distanceTravelledCm = robot.distanceTravelledCm;

    // Count a collision once per contact rather than once per physics step.
    if (robot.collided && !this.wasColliding) s.collisions += 1;
    this.wasColliding = robot.collided;

    const onLine = robot.leftOnLine || robot.rightOnLine;
    if (onLine) {
      s.onLineSeconds += dt;
      s.currentOffLineSeconds = 0;
    } else {
      s.currentOffLineSeconds += dt;
      if (s.currentOffLineSeconds > s.longestOffLineSeconds) {
        s.longestOffLineSeconds = s.currentOffLineSeconds;
      }
    }

    const fromStart = Math.hypot(robot.pose.x - arena.start.x, robot.pose.y - arena.start.y);
    s.distanceFromStartCm = fromStart;
    if (fromStart > s.maxDistanceFromStartCm) s.maxDistanceFromStartCm = fromStart;
    if (fromStart > LEFT_START_RADIUS_CM) this.hasLeftStart = true;
    if (this.hasLeftStart && fromStart < START_RADIUS_CM) s.returnedToStart = true;

    for (const zone of arena.zones) {
      if (!zone.goal) continue;
      const inside =
        robot.pose.x >= zone.x &&
        robot.pose.x <= zone.x + zone.width &&
        robot.pose.y >= zone.y &&
        robot.pose.y <= zone.y + zone.height;
      if (inside && !s.visitedGoalZones.includes(zone.id)) s.visitedGoalZones.push(zone.id);
    }

    this.sampleLaps(engine);
  }

  /** Checkpoints derived from the arena's closed course, used for lap counting. */
  private sampleLaps(engine: SimulationEngine): void {
    const { arena, robot } = engine;
    if (this.arenaIdForCheckpoints !== arena.id) {
      this.checkpoints = buildCheckpoints(engine);
      this.arenaIdForCheckpoints = arena.id;
      this.nextCheckpoint = 0;
      this.checkpointsHit = 0;
    }
    if (this.checkpoints.length === 0) return;

    const target = this.checkpoints[this.nextCheckpoint];
    const d = Math.hypot(robot.pose.x - target.x, robot.pose.y - target.y);
    if (d <= CHECKPOINT_RADIUS_CM) {
      this.nextCheckpoint = (this.nextCheckpoint + 1) % this.checkpoints.length;
      this.checkpointsHit += 1;
      if (this.checkpointsHit >= this.checkpoints.length) {
        this.stats.laps += 1;
        this.checkpointsHit = 0;
      }
    }
    this.stats.lapProgress = this.checkpointsHit / this.checkpoints.length;
  }
}

function emptyStats(): ChallengeStats {
  return {
    elapsed: 0,
    collisions: 0,
    distanceTravelledCm: 0,
    onLineSeconds: 0,
    currentOffLineSeconds: 0,
    longestOffLineSeconds: 0,
    maxDistanceFromStartCm: 0,
    distanceFromStartCm: 0,
    visitedGoalZones: [],
    returnedToStart: false,
    laps: 0,
    lapProgress: 0,
  };
}

/**
 * Samples a closed line course into evenly spaced checkpoints that must be
 * visited in order. Ordering is what stops a robot wiggling on the start line
 * from racking up laps.
 */
function buildCheckpoints(engine: SimulationEngine): Vec2[] {
  const closed = engine.arena.lines.find((line) => line.closed && line.points.length > 2);
  if (!closed) return [];

  const pts = closed.points;
  const segments: { a: Vec2; b: Vec2; length: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, length });
    total += length;
  }
  if (total === 0) return [];

  const checkpoints: Vec2[] = [];
  for (let i = 0; i < CHECKPOINT_COUNT; i += 1) {
    let target = (i / CHECKPOINT_COUNT) * total;
    for (const seg of segments) {
      if (target <= seg.length) {
        const t = seg.length === 0 ? 0 : target / seg.length;
        checkpoints.push({
          x: seg.a.x + (seg.b.x - seg.a.x) * t,
          y: seg.a.y + (seg.b.y - seg.a.y) * t,
        });
        break;
      }
      target -= seg.length;
    }
  }
  return checkpoints;
}
