import type { Arena, RobotPose, RobotTelemetry, Rgb } from '../types';
import { Robot } from './Robot';
import { PHYSICS_STEP_S } from './constants';
import { clamp, round } from '../utils/units';
import { ChallengeTracker } from '../challenges/ChallengeTracker';
import { clampMass, resolveRobotPush } from './RobotPhysics';

export type FrameListener = (engine: SimulationEngine) => void;

interface PendingWait {
  deadline: number;
  resolve: () => void;
}

/**
 * Owns the simulated world and drives it from a single requestAnimationFrame
 * loop.
 *
 * Everything mutable lives here rather than in React state: the loop runs at
 * 60 fps and re-rendering the component tree that often would make the Blockly
 * workspace stutter. Components subscribe to frames and pull what they need,
 * throttling themselves as appropriate.
 */
export class SimulationEngine {
  arena: Arena;
  robot: Robot;
  /**
   * Second robot, present either because the arena scripts one in (the
   * Battle Bot Arena) or because the student turned on the practice opponent.
   * See {@link opponentIsParked} for which kind this is.
   */
  opponent: Robot | null = null;
  /**
   * True when {@link opponent} is the student-placed practice robot rather
   * than the Battle Bot Arena's scripted one.
   *
   * A parked opponent never drives itself, but it is a real physical body: it
   * is sensed like any obstacle, and a robot with enough mass and motor power
   * behind it can shove it out of the way (see RobotPhysics.resolveRobotPush).
   */
  opponentIsParked = false;

  /** Simulated seconds since the last reset. */
  clock = 0;
  speed = 1;
  /** True while a student program is executing. */
  programRunning = false;
  /** Manual driving command, or null when manual control is inactive. */
  manualDrive: { left: number; right: number } | null = null;

  readonly challenges = new ChallengeTracker();

  private frameListeners = new Set<FrameListener>();
  private waits: PendingWait[] = [];
  private rafHandle: number | null = null;
  private lastFrameMs = 0;

  /**
   * Robot API calls the runtime may service per frame. Without a cap a tight
   * `forever` loop would flood the main thread with messages and starve
   * rendering; with it, a control loop runs at a brisk but bounded rate.
   */
  private static readonly CALLS_PER_FRAME = 16;
  private callCredits = SimulationEngine.CALLS_PER_FRAME;
  private creditWaiters: (() => void)[] = [];

  /**
   * Resolvers for programs parked in `yield`, released at the end of each frame.
   *
   * Together with {@link waits} this is what "the program is blocked on time"
   * means. While a program is running and blocked on neither, the world is held
   * still - see {@link update}.
   */
  private yieldWaiters: (() => void)[] = [];
  private frozenFrames = 0;
  /**
   * Safety valve. If a program somehow goes quiet without blocking on time,
   * let the world run again rather than appearing to hang.
   */
  private static readonly MAX_FROZEN_FRAMES = 8;

  constructor(arena: Arena) {
    this.arena = arena;
    this.robot = new Robot(arena.start);
    this.applyOpponent(arena);
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastFrameMs = performance.now();
    const loop = (nowMs: number) => {
      const dtMs = nowMs - this.lastFrameMs;
      this.lastFrameMs = nowMs;
      // Clamp so a backgrounded tab does not fast-forward the world on return.
      this.update(clamp(dtMs, 0, 100));
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.clearWaits();
    this.frameListeners.clear();
  }

  subscribeFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  // --- world ---------------------------------------------------------------

  /**
   * Swaps in a new arena.
   *
   * `preservePoses` keeps both robots exactly where they are instead of
   * resetting them. Committing a dragged start position produces a new arena
   * object purely to record that pose, and resetting there would yank the
   * robot back to the start mid-experiment - so those edits pass `true`.
   */
  setArena(arena: Arena, options: { preservePoses?: boolean } = {}): void {
    const keptRobot = { ...this.robot.pose };
    const keptOpponent = this.opponent ? { ...this.opponent.pose } : null;
    const wasParked = this.opponentIsParked;

    this.arena = arena;
    this.applyOpponent(arena);
    this.resetRobot();

    if (options.preservePoses) {
      this.robot.pose = keptRobot;
      // The parked opponent is re-created by the caller straight after this,
      // so only a scripted one can be restored here.
      if (this.opponent && keptOpponent && !wasParked) this.opponent.pose = keptOpponent;
      this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    }
  }

  /** Full reset: pose, motors, LEDs, display, clock and challenge progress. */
  resetRobot(): void {
    this.robot.reset(this.arena.start);
    if (this.arena.opponent && this.opponent) {
      this.opponent.reset(this.arena.opponent.start);
    } else if (this.opponentIsParked && this.opponent) {
      // The parked opponent can be shoved around during a run, so Reset puts
      // it back on the spot the student set for it.
      const mass = this.opponent.massKg;
      this.opponent.reset(this.arena.opponentStart ?? this.opponent.pose);
      this.opponent.massKg = mass;
    }
    this.clock = 0;
    this.manualDrive = null;
    this.clearWaits();
    this.challenges.reset();
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  /** Drag-to-reposition support; ignored while a program is running. */
  moveRobotTo(x: number, y: number): void {
    if (this.programRunning) return;
    // Picking the robot up is a hand-over of control: it should stay where it
    // is put rather than driving off again on a leftover motor command.
    this.robot.stop();
    this.robot.pose.x = clamp(x, this.robot.radiusCm, this.arena.widthCm - this.robot.radiusCm);
    this.robot.pose.y = clamp(y, this.robot.radiusCm, this.arena.heightCm - this.robot.radiusCm);
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  setRobotHeading(heading: number): void {
    if (this.programRunning) return;
    this.robot.pose.heading = heading;
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  // --- parked practice opponent ---------------------------------------------

  /**
   * Adds, moves or removes the student-placed practice opponent.
   *
   * Pass a pose to place it there (creating it if it does not already exist)
   * or `null` to remove it. Does nothing on an arena that already scripts its
   * own opponent (the Battle Bot Arena) - there is only ever one second robot
   * at a time, and that one drives itself.
   */
  setParkedOpponent(pose: RobotPose | null): void {
    if (this.arena.opponent) return;

    if (pose === null) {
      this.opponent = null;
      this.opponentIsParked = false;
    } else if (this.opponentIsParked && this.opponent) {
      // Reuse the existing robot so its configured mass survives a re-place.
      this.opponent.pose = { ...pose };
    } else {
      this.opponent = new Robot(pose);
      this.opponentIsParked = true;
    }

    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  /** Drag-to-reposition for the parked opponent; ignored while running. */
  moveOpponentTo(x: number, y: number): void {
    if (this.programRunning || !this.opponentIsParked || !this.opponent) return;
    const radius = this.opponent.radiusCm;
    this.opponent.pose.x = clamp(x, radius, this.arena.widthCm - radius);
    this.opponent.pose.y = clamp(y, radius, this.arena.heightCm - radius);
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  /** Drag-to-rotate for the parked opponent; ignored while running. */
  setOpponentHeading(heading: number): void {
    if (this.programRunning || !this.opponentIsParked || !this.opponent) return;
    this.opponent.pose.heading = heading;
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    this.notify();
  }

  /** Applies the student's configured masses to whichever robots exist. */
  setMasses(robotMassKg: number, opponentMassKg: number): void {
    this.robot.massKg = clampMass(robotMassKg);
    if (this.opponent) this.opponent.massKg = clampMass(opponentMassKg);
  }

  // --- program run control -------------------------------------------------

  beginProgram(): void {
    this.programRunning = true;
    this.manualDrive = null;
    this.challenges.reset();
    this.clock = 0;
    this.robot.distanceTravelledCm = 0;
  }

  /**
   * Ends the run and leaves the robot where it is.
   *
   * `stopMotors` distinguishes the two ways a run can end. Pressing Stop (or
   * hitting an error) cuts the motors. A program that simply reaches its last
   * block does **not**: a real mBot latches its motor state and keeps driving
   * until something tells it otherwise, which is exactly why every mBot lesson
   * ends with a `stop moving` block. Zeroing here instead would make the very
   * first thing a student tries - one `move forward` block - appear to do
   * nothing at all.
   */
  endProgram(stopMotors = true): void {
    this.programRunning = false;
    if (stopMotors) this.robot.stop();
    this.clearWaits();
  }

  /** True when the robot is still driving with no program in control of it. */
  get coasting(): boolean {
    return !this.programRunning && (this.robot.leftMotor !== 0 || this.robot.rightMotor !== 0);
  }

  /**
   * Sets the timer back to 0 without touching pose, motors, LEDs or the
   * display - the narrower cousin of a full Reset, for the `reset timer`
   * block. Matches mBlock's own "reset timer" action.
   */
  resetTimer(): void {
    this.clock = 0;
    this.notify();
  }

  // --- runtime services used by the worker bridge --------------------------

  /**
   * Resolves after `seconds` of *simulated* time, so waits stretch and shrink
   * with the speed control exactly like robot motion does.
   */
  wait(seconds: number): Promise<void> {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (safe === 0) return this.yieldTick();
    return new Promise<void>((resolve) => {
      this.waits.push({ deadline: this.clock + safe, resolve });
    });
  }

  /**
   * Lets exactly one simulation frame pass.
   *
   * The block generators put one of these at the top of every loop body, so a
   * `forever` control loop runs at the simulation frame rate - the same shape a
   * real robot's main loop has - and an empty loop can never become a spin.
   */
  yieldTick(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.yieldWaiters.push(resolve);
    });
  }

  /** True while the program is parked waiting for simulated time to pass. */
  private get blockedOnTime(): boolean {
    return this.waits.length > 0 || this.yieldWaiters.length > 0;
  }

  /**
   * Rate-limits robot API calls. Resolves immediately while this frame still
   * has budget, otherwise on the next frame.
   */
  nextSlot(): Promise<void> {
    if (this.callCredits > 0) {
      this.callCredits -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.creditWaiters.push(resolve));
  }

  private clearWaits(): void {
    this.frozenFrames = 0;
    for (const resolve of this.yieldWaiters) resolve();
    this.yieldWaiters = [];
    // Resolve rather than drop: any awaiting worker is about to be terminated,
    // and leaving dangling promises would leak them.
    for (const wait of this.waits) wait.resolve();
    this.waits = [];
    for (const waiter of this.creditWaiters) waiter();
    this.creditWaiters = [];
  }

  // --- simulation step -----------------------------------------------------

  update(realDtMs: number): void {
    let simDt = (realDtMs / 1000) * this.speed;

    // Manual driving only applies when no student program owns the motors.
    // With no program and no manual input the motors are left exactly as they
    // were: whoever last set them owns them until Stop, Reset or a drag. (This
    // used to force them to zero every idle frame, which silently undid the
    // last motor command of any program that ended without `stop moving`.)
    if (!this.programRunning && this.manualDrive) {
      this.robot.setMotors(this.manualDrive.left, this.manualDrive.right);
    }

    // A running program only lets time pass while it is blocked on time - in a
    // `wait`, or in the per-iteration `yield`. Everything else a program does
    // (setting motors, reading a sensor, evaluating a condition) is effectively
    // instantaneous on real hardware, and the messages that carry it take real
    // milliseconds here. Freezing across those gaps is what stops a
    // `turn right / wait 0.45` corner from overshooting by the round-trip time.
    if (this.programRunning && !this.blockedOnTime) {
      this.frozenFrames += 1;
      if (this.frozenFrames <= SimulationEngine.MAX_FROZEN_FRAMES) simDt = 0;
    } else {
      this.frozenFrames = 0;
    }

    // Fixed substeps keep collisions stable no matter the frame rate or speed.
    let remaining = simDt;
    let guard = 0;
    while (remaining > 1e-6 && guard < 480) {
      // Land exactly on the next wait deadline rather than overshooting it by
      // up to a whole substep.
      let dt = Math.min(PHYSICS_STEP_S, remaining);
      const deadline = this.earliestWaitDeadline();
      if (deadline !== null) {
        const toDeadline = deadline - this.clock;
        if (toDeadline > 1e-9 && toDeadline < dt) dt = toDeadline;
      }

      this.substep(dt);
      remaining -= dt;
      guard += 1;

      // A wait just finished: stop consuming this frame so the program can act
      // before the robot travels any further.
      if (this.releaseWaits()) break;
    }

    this.releaseYields();
    this.refillCredits();
    this.notify();
  }

  /** Frees every program parked in `yield`; one frame has now passed. */
  private releaseYields(): void {
    if (this.yieldWaiters.length === 0) return;
    const waiters = this.yieldWaiters;
    this.yieldWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private earliestWaitDeadline(): number | null {
    let earliest: number | null = null;
    for (const wait of this.waits) {
      if (earliest === null || wait.deadline < earliest) earliest = wait.deadline;
    }
    return earliest;
  }

  private substep(dt: number): void {
    this.clock += dt;

    // A parked opponent never drives itself. The scripted Battle Bot one does,
    // but only while someone is actually driving, so it does not shove the
    // robot around while a student is editing blocks.
    if (this.opponent && !this.opponentIsParked) {
      if (this.programRunning || this.manualDrive) {
        driveOpponent(this.opponent, this.robot, this.arena);
      } else {
        this.opponent.stop();
      }
    }

    // Move every robot against the fixed world first...
    this.robot.integrate(dt, this.arena);
    if (this.opponent) this.opponent.integrate(dt, this.arena);

    // ...then settle robot-against-robot contact once, with masses on both
    // sides, so a heavy robot under power can shove a lighter one aside.
    if (this.opponent) resolveRobotPush(this.robot, this.opponent, this.arena);

    // Sensors last, so every reading reflects where everything ended up.
    this.robot.refreshSensors(this.arena, this.otherRobots(this.robot));
    if (this.opponent) {
      this.opponent.refreshSensors(this.arena, this.otherRobots(this.opponent));
    }

    this.challenges.sample(this, dt);
  }

  /** Resolves any waits that are due. Returns true when at least one fired. */
  private releaseWaits(): boolean {
    if (this.waits.length === 0) return false;
    const due = this.waits.filter((w) => w.deadline <= this.clock + 1e-9);
    if (due.length === 0) return false;
    this.waits = this.waits.filter((w) => w.deadline > this.clock + 1e-9);
    for (const wait of due) wait.resolve();
    return true;
  }

  private refillCredits(): void {
    this.callCredits = SimulationEngine.CALLS_PER_FRAME;
    const waiters = this.creditWaiters;
    this.creditWaiters = [];
    for (const resolve of waiters) {
      if (this.callCredits <= 0) {
        // Out of budget again - push back to the next frame.
        this.creditWaiters.push(resolve);
      } else {
        this.callCredits -= 1;
        resolve();
      }
    }
  }

  private notify(): void {
    for (const listener of this.frameListeners) listener(this);
  }

  private applyOpponent(arena: Arena): void {
    // A fresh arena starts with no opponent of either kind; the caller
    // (App.tsx) re-applies a stationary one afterwards if the student's
    // "include opponent" setting is on, now that the new arena's obstacles are
    // known and a sensible spot can be picked for it.
    this.opponent = arena.opponent ? new Robot(arena.opponent.start) : null;
    this.opponentIsParked = false;
  }

  private otherRobots(exclude: Robot): Robot[] {
    const all = this.opponent ? [this.robot, this.opponent] : [this.robot];
    return all.filter((r) => r !== exclude);
  }

  // --- telemetry -----------------------------------------------------------

  getTelemetry(): RobotTelemetry {
    const r = this.robot;
    return {
      x: round(r.pose.x, 1),
      y: round(r.pose.y, 1),
      headingDeg: round(r.headingDeg, 0),
      leftMotor: r.leftMotor,
      rightMotor: r.rightMotor,
      ultrasonicCm: round(r.ultrasonic.distanceCm, 1),
      lineValue: r.lineValue,
      leftOnLine: r.leftOnLine,
      rightOnLine: r.rightOnLine,
      ledLeft: cloneRgb(r.ledLeft),
      ledRight: cloneRgb(r.ledRight),
      display: r.display,
      clock: round(this.clock, 1),
      collided: r.collided,
      distanceTravelledCm: round(r.distanceTravelledCm, 0),
    };
  }
}

function cloneRgb(rgb: Rgb): Rgb {
  return { r: rgb.r, g: rgb.g, b: rgb.b };
}

/**
 * Behaviour for the scripted Battle Bot opponent. Deliberately simple - it is
 * an experimental feature, and the point is to prove the engine can host a
 * second robot without special cases.
 */
function driveOpponent(opponent: Robot, player: Robot, arena: Arena): void {
  const spec = arena.opponent;
  if (!spec) return;

  if (spec.behavior === 'idle') {
    opponent.stop();
    return;
  }

  if (spec.behavior === 'patrol') {
    // Creep forward, veering away when the wall gets close.
    const clear = opponent.ultrasonic.distanceCm === 0 || opponent.ultrasonic.distanceCm > 25;
    if (clear) opponent.setMotors(spec.power, spec.power);
    else opponent.setMotors(spec.power, -spec.power);
    return;
  }

  // 'seek': steer towards the player robot.
  const dx = player.pose.x - opponent.pose.x;
  const dy = player.pose.y - opponent.pose.y;
  const target = Math.atan2(dy, dx);
  let error = target - opponent.pose.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;

  const turn = clamp(error * 2.2, -1, 1) * spec.power;
  const forward = spec.power * 0.85;
  opponent.setMotors(clamp(forward + turn, -255, 255), clamp(forward - turn, -255, 255));
}
