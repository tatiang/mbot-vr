import type { Arena, Rgb, RobotPose } from '../types';
import type { SimulationEngine } from './SimulationEngine';
import type { Robot } from './Robot';
import { ROBOT } from './constants';
import { toWorld } from '../utils/geometry';

export interface RenderOptions {
  /** Ultrasonic cone, rays, hit point and distance label. */
  showDistanceSensor: boolean;
  /** Line sensor dots and the collision footprint. */
  showLineSensors: boolean;
  showGrid: boolean;
  /** Highlights the robot when the pointer is over it, for drag-to-move. */
  hoveringRobot: boolean;
  dragging: boolean;
  /** Same idea as {@link hoveringRobot}, for the draggable parked opponent. */
  hoveringOpponent: boolean;
  draggingOpponent: boolean;
  /** Show the drag-to-rotate handles; suppressed while a program runs. */
  showHandles: boolean;
}

/** How far out from a robot's centre its rotate handle sits, in cm. */
export const ROTATE_HANDLE_DISTANCE_CM = ROBOT.radiusCm + 7;
/** Radius of the handle itself, and the slack allowed when grabbing it. */
export const ROTATE_HANDLE_RADIUS_CM = 2.2;

/**
 * Where a robot's rotate handle sits in world space.
 *
 * Shared with the canvas so hit-testing and drawing can never drift apart.
 */
export function rotateHandlePosition(
  x: number,
  y: number,
  heading: number,
): { x: number; y: number } {
  return {
    x: x + Math.cos(heading) * ROTATE_HANDLE_DISTANCE_CM,
    y: y + Math.sin(heading) * ROTATE_HANDLE_DISTANCE_CM,
  };
}

const COLORS = {
  floor: '#f7f9fc',
  grid: '#e2e8f2',
  gridStrong: '#ccd6e6',
  wall: '#7c879b',
  wallEdge: '#5d6879',
  block: '#f0a04b',
  blockEdge: '#c97f2e',
  line: '#14181f',
  chassis: '#1f6fd0',
  chassisDark: '#164f96',
  chassisLight: '#3d8ce8',
  wheel: '#22262e',
  wheelHub: '#454b57',
  board: '#0f4c9a',
  overlay: '#00a3a3',
  overlayHit: '#e0463f',
  sensorOn: '#22b573',
  sensorOff: '#8892a4',
  text: '#1f2937',
};

/**
 * Draws the arena and robot onto a 2D canvas.
 *
 * The renderer is a plain class rather than a React component: it is called
 * once per animation frame straight from the simulation loop, and going
 * through React at that rate would be both slow and pointless.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** Pixels per centimetre for the current canvas size. */
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not create a 2D canvas for the simulator.');
    this.ctx = ctx;
  }

  /** Resizes the backing store for the current CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, arena: Arena): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Fit the arena with a small margin, preserving aspect ratio.
    const margin = 12;
    const usableW = cssWidth - margin * 2;
    const usableH = cssHeight - margin * 2;
    this.scale = Math.max(0.1, Math.min(usableW / arena.widthCm, usableH / arena.heightCm)) * dpr;
    this.offsetX = (this.canvas.width - arena.widthCm * this.scale) / 2;
    this.offsetY = (this.canvas.height - arena.heightCm * this.scale) / 2;
  }

  /** Converts a canvas-relative CSS pixel position into world centimetres. */
  screenToWorld(cssX: number, cssY: number): { x: number; y: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      x: (cssX * dpr - this.offsetX) / this.scale,
      y: (cssY * dpr - this.offsetY) / this.scale,
    };
  }

  worldToScreenCss(x: number, y: number): { x: number; y: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      x: (this.offsetX + x * this.scale) / dpr,
      y: (this.offsetY + y * this.scale) / dpr,
    };
  }

  /**
   * Runs `paint` with the world transform applied, so callers (the arena
   * editor's drag preview) can draw in centimetres without duplicating the
   * camera maths. Call after {@link draw}.
   */
  withWorldTransform(paint: (ctx: CanvasRenderingContext2D) => void): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    paint(ctx);
    ctx.restore();
  }

  draw(engine: SimulationEngine, options: RenderOptions): void {
    const { ctx } = this;
    const arena = engine.arena;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Backdrop outside the arena.
    ctx.fillStyle = '#e9edf5';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this.drawFloor(arena);
    if (options.showGrid && arena.gridCm > 0) this.drawGrid(arena);
    this.drawZones(arena);
    this.drawLines(arena);
    this.drawStartMarkers(engine);
    this.drawObstacles(arena);

    if (engine.opponent) {
      const active = options.hoveringOpponent || options.draggingOpponent;
      this.drawRobot(
        engine.opponent,
        engine.opponentIsParked && active,
        '#c2413c',
        '#8d2a26',
        engine.opponentIsParked && options.showHandles && active,
      );
    }
    const robotActive = options.hoveringRobot || options.dragging;
    this.drawRobot(
      engine.robot,
      robotActive,
      undefined,
      undefined,
      options.showHandles && robotActive,
    );

    if (options.showDistanceSensor) this.drawUltrasonicOverlay(engine.robot);
    if (options.showLineSensors) {
      this.drawLineSensorOverlay(engine.robot);
      this.drawFootprint(engine.robot);
    }

    ctx.restore();
  }

  // --- arena ---------------------------------------------------------------

  private drawFloor(arena: Arena): void {
    const { ctx } = this;
    ctx.fillStyle = arena.floorColor ?? COLORS.floor;
    ctx.fillRect(0, 0, arena.widthCm, arena.heightCm);
  }

  private drawGrid(arena: Arena): void {
    const { ctx } = this;
    const step = arena.gridCm;
    ctx.lineWidth = 0.4;
    for (let x = 0; x <= arena.widthCm + 0.001; x += step) {
      ctx.strokeStyle = x % (step * 5) === 0 ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, arena.heightCm);
      ctx.stroke();
    }
    for (let y = 0; y <= arena.heightCm + 0.001; y += step) {
      ctx.strokeStyle = y % (step * 5) === 0 ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(arena.widthCm, y);
      ctx.stroke();
    }
  }

  private drawZones(arena: Arena): void {
    const { ctx } = this;
    for (const z of arena.zones) {
      ctx.fillStyle = z.color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(z.x, z.y, z.width, z.height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(z.x, z.y, z.width, z.height);
      if (z.label) {
        ctx.fillStyle = COLORS.text;
        ctx.font = '5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.label, z.x + z.width / 2, z.y + z.height / 2);
      }
    }
  }

  private drawLines(arena: Arena): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.line;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of arena.lines) {
      if (path.points.length === 0) continue;
      ctx.lineWidth = path.width;
      if (path.points.length === 1) {
        ctx.fillStyle = COLORS.line;
        ctx.beginPath();
        ctx.arc(path.points[0].x, path.points[0].y, path.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i += 1) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      if (path.closed) ctx.closePath();
      ctx.stroke();
    }
  }

  private drawObstacles(arena: Arena): void {
    const { ctx } = this;
    for (const o of arena.obstacles) {
      const isBlock = o.kind === 'block';
      ctx.fillStyle = o.color ?? (isBlock ? COLORS.block : COLORS.wall);
      ctx.strokeStyle = isBlock ? COLORS.blockEdge : COLORS.wallEdge;
      ctx.lineWidth = 0.6;
      ctx.fillRect(o.x, o.y, o.width, o.height);
      ctx.strokeRect(o.x, o.y, o.width, o.height);
    }
  }

  /** Faint ghost of the reset pose, so students can see where Reset will send them. */
  /**
   * Ghost outlines showing where Reset will send each robot.
   *
   * Only drawn when a robot is actually away from its start - while it is
   * sitting on its start pose (which is the case whenever you have just
   * dragged it there) the ghost would sit exactly under the robot and read as
   * a rendering glitch.
   */
  private drawStartMarkers(engine: SimulationEngine): void {
    const away = (pose: { x: number; y: number }, start: { x: number; y: number }) =>
      Math.hypot(pose.x - start.x, pose.y - start.y) > 1.5;

    if (away(engine.robot.pose, engine.arena.start)) {
      this.drawStartGhost(engine.arena.start, '#2b6cb0');
    }

    const opponentStart = engine.arena.opponentStart;
    if (engine.opponent && engine.opponentIsParked && opponentStart) {
      if (away(engine.opponent.pose, opponentStart)) {
        this.drawStartGhost(opponentStart, '#b0442b');
      }
    }
  }

  private drawStartGhost(pose: RobotPose, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.heading);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(-ROBOT.lengthCm / 2, -ROBOT.widthCm / 2, ROBOT.lengthCm, ROBOT.widthCm);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ROBOT.lengthCm / 2, 0);
    ctx.lineTo(ROBOT.lengthCm / 2 + 5, 0);
    ctx.lineTo(ROBOT.lengthCm / 2 + 2.5, -2);
    ctx.moveTo(ROBOT.lengthCm / 2 + 5, 0);
    ctx.lineTo(ROBOT.lengthCm / 2 + 2.5, 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- robot ---------------------------------------------------------------

  /**
   * Draws one mBot from above.
   *
   * Laid out to read as the real robot at a glance: the blue aluminium plate
   * with its grid of mounting holes, fat black tyres standing proud of the
   * chassis, the rear caster ball, the mCore board with its two RGB LEDs, and
   * the ultrasonic module hanging off the nose with its two transducer cans.
   * All original artwork - no Makeblock assets are used.
   */
  private drawRobot(
    robot: Robot,
    emphasised = false,
    bodyColor?: string,
    bodyDark?: string,
    showRotateHandle = false,
  ): void {
    const { ctx } = this;
    // Chassis plate is narrower than the robot's full width; the tyres make up
    // the rest, which is what gives an mBot its stance.
    const plateHalfW = 6.4;
    const plateBack = -7.2;
    const plateFront = 5.6;

    ctx.save();
    ctx.translate(robot.pose.x, robot.pose.y);
    ctx.rotate(robot.pose.heading);

    // Soft drop shadow under the whole robot.
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#0b1220';
    roundRect(ctx, plateBack + 0.7, -plateHalfW + 0.9, plateFront - plateBack, plateHalfW * 2, 2.2);
    ctx.fill();
    ctx.restore();

    this.drawWheels();
    this.drawCaster(plateBack);
    this.drawChassisPlate(plateBack, plateFront, plateHalfW, bodyColor, bodyDark);
    this.drawUltrasonicModule(plateFront);
    this.drawMainboard(robot, plateHalfW);
    this.drawLineSensorModule();

    ctx.restore();

    if (emphasised) {
      ctx.save();
      ctx.strokeStyle = '#2b6cb0';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2.5, 2]);
      ctx.beginPath();
      ctx.arc(robot.pose.x, robot.pose.y, ROBOT.radiusCm + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (robot.collided) {
      ctx.save();
      ctx.strokeStyle = 'rgba(224,70,63,0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(robot.pose.x, robot.pose.y, ROBOT.radiusCm + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (showRotateHandle) this.drawRotateHandle(robot);
  }

  /** Fat black tyres, standing proud of the chassis on both sides. */
  private drawWheels(): void {
    const { ctx } = this;
    const outer = ROBOT.widthCm / 2;
    const inner = outer - 2.4;
    for (const side of [-1, 1]) {
      const y0 = side < 0 ? -outer : inner;

      ctx.fillStyle = COLORS.wheel;
      roundRect(ctx, -3.6, y0, 6.6, 2.4, 1.0);
      ctx.fill();
      ctx.strokeStyle = '#0d1015';
      ctx.lineWidth = 0.25;
      ctx.stroke();

      // Tread bands across the tyre.
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 0.28;
      for (let i = 1; i < 6; i += 1) {
        const x = -3.6 + (i / 6) * 6.6;
        ctx.beginPath();
        ctx.moveTo(x, y0 + 0.25);
        ctx.lineTo(x, y0 + 2.15);
        ctx.stroke();
      }

      // Hub cap peeking over the top of the tyre.
      ctx.fillStyle = COLORS.wheelHub;
      ctx.beginPath();
      ctx.arc(-0.3, y0 + 1.2, 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.2;
      ctx.stroke();
    }
  }

  /** The little rear ball caster the mBot balances on. */
  private drawCaster(plateBack: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#39404d';
    ctx.beginPath();
    ctx.arc(plateBack + 1.6, 0, 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8f98a8';
    ctx.beginPath();
    ctx.arc(plateBack + 1.6, 0, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Blue anodised plate, with the mBot's characteristic hole grid. */
  private drawChassisPlate(
    back: number,
    front: number,
    halfW: number,
    bodyColor?: string,
    bodyDark?: string,
  ): void {
    const { ctx } = this;
    const body = bodyColor ?? COLORS.chassis;
    const dark = bodyDark ?? COLORS.chassisDark;
    const light = bodyColor ? body : COLORS.chassisLight;

    const grad = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grad.addColorStop(0, light);
    grad.addColorStop(0.45, body);
    grad.addColorStop(1, dark);

    ctx.fillStyle = grad;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.45;
    roundRect(ctx, back, -halfW, front - back, halfW * 2, 2.2);
    ctx.fill();
    ctx.stroke();

    // Mounting-hole grid. Clipped to the plate so holes never spill over the
    // rounded corners.
    ctx.save();
    roundRect(ctx, back, -halfW, front - back, halfW * 2, 2.2);
    ctx.clip();
    ctx.fillStyle = 'rgba(4,20,44,0.38)';
    for (let x = back + 1.6; x <= front - 1.0; x += 2.0) {
      for (let y = -halfW + 1.4; y <= halfW - 1.0; y += 2.0) {
        ctx.beginPath();
        ctx.arc(x, y, 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Two long slots along the flanks, as on the real plate.
    ctx.fillStyle = 'rgba(4,20,44,0.22)';
    for (const y of [-halfW + 0.85, halfW - 1.35]) {
      roundRect(ctx, back + 2.2, y, 7.0, 0.5, 0.25);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The ultrasonic board on the nose: dark PCB, two big transducer cans. */
  private drawUltrasonicModule(plateFront: number): void {
    const { ctx } = this;
    const boardBack = plateFront - 0.6;
    const boardFront = plateFront + 1.9;

    ctx.fillStyle = '#16233a';
    ctx.strokeStyle = '#0c1524';
    ctx.lineWidth = 0.3;
    roundRect(ctx, boardBack, -5.0, boardFront - boardBack, 10.0, 0.8);
    ctx.fill();
    ctx.stroke();

    const cx = (boardBack + boardFront) / 2;
    for (const ey of [-2.8, 2.8]) {
      // Aluminium can.
      const canGrad = ctx.createRadialGradient(cx - 0.4, ey - 0.4, 0.2, cx, ey, 2.15);
      canGrad.addColorStop(0, '#f2f5fa');
      canGrad.addColorStop(0.55, '#c9d2e0');
      canGrad.addColorStop(1, '#8d97a8');
      ctx.fillStyle = canGrad;
      ctx.beginPath();
      ctx.arc(cx, ey, 2.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6d7686';
      ctx.lineWidth = 0.28;
      ctx.stroke();

      // Mesh face.
      ctx.fillStyle = '#5f6875';
      ctx.beginPath();
      ctx.arc(cx, ey, 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 0.18;
      for (let r = 0.45; r < 1.4; r += 0.42) {
        ctx.beginPath();
        ctx.arc(cx, ey, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** mCore board on top: LEDs, button, buzzer and the numeric display. */
  private drawMainboard(robot: Robot, plateHalfW: number): void {
    const { ctx } = this;

    ctx.fillStyle = 'rgba(9,32,66,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.3;
    roundRect(ctx, -5.6, -plateHalfW + 1.5, 9.4, (plateHalfW - 1.5) * 2, 1.0);
    ctx.fill();
    ctx.stroke();

    // Pin headers along the board edges.
    ctx.fillStyle = 'rgba(240,245,255,0.35)';
    for (const y of [-plateHalfW + 2.0, plateHalfW - 2.5]) {
      roundRect(ctx, -4.6, y, 5.4, 0.5, 0.2);
      ctx.fill();
    }

    // Buzzer.
    ctx.fillStyle = '#111a28';
    ctx.beginPath();
    ctx.arc(2.4, -2.6, 0.85, 0, Math.PI * 2);
    ctx.fill();

    // Onboard button.
    ctx.fillStyle = '#dfe6f2';
    roundRect(ctx, 1.9, 1.9, 1.5, 1.5, 0.3);
    ctx.fill();

    // The two RGB LEDs. A dark LED still shows as a ring so its position is
    // visible before a program sets a colour.
    this.drawLed(0.2, -3.3, robot.ledLeft);
    this.drawLed(0.2, 3.3, robot.ledRight);

    // Four-digit display module. The type is sized so a full "-999" still
    // sits inside the bezel rather than spilling across the chassis.
    ctx.fillStyle = '#0b1220';
    roundRect(ctx, -5.3, -1.6, 5.2, 3.2, 0.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.2;
    ctx.stroke();
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 1.7px "SFMono-Regular", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(robot.display.trim(), -2.7, 0.05);
  }

  /** Line-follower board slung under the nose, with its two IR pairs. */
  private drawLineSensorModule(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(12,20,34,0.45)';
    roundRect(ctx, ROBOT.lineSensorForwardCm - 1.5, -3.0, 2.6, 6.0, 0.5);
    ctx.fill();

    for (const side of [-1, 1]) {
      const y = side * ROBOT.lineSensorSideCm;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(ROBOT.lineSensorForwardCm - 0.7, y, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,190,255,0.75)';
      ctx.beginPath();
      ctx.arc(ROBOT.lineSensorForwardCm + 0.3, y, 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Grab handle for setting a robot's facing before a run.
   *
   * Drawn out in front on the heading line so the direction it sets is
   * obvious, with a curved arrow to say "drag me round" rather than "drag me
   * along".
   */
  private drawRotateHandle(robot: Robot): void {
    const { ctx } = this;
    const pos = rotateHandlePosition(robot.pose.x, robot.pose.y, robot.pose.heading);

    ctx.save();
    ctx.strokeStyle = 'rgba(43,108,176,0.55)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1.2, 1.2]);
    ctx.beginPath();
    ctx.moveTo(robot.pose.x, robot.pose.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2b6cb0';
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, ROTATE_HANDLE_RADIUS_CM, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Curved arrow inside the handle.
    ctx.strokeStyle = '#2b6cb0';
    ctx.lineWidth = 0.42;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.35, Math.PI * 0.15, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x + 1.35, pos.y + 0.05);
    ctx.lineTo(pos.x + 1.9, pos.y + 0.55);
    ctx.lineTo(pos.x + 0.85, pos.y + 0.75);
    ctx.closePath();
    ctx.fillStyle = '#2b6cb0';
    ctx.fill();
    ctx.restore();
  }

  private drawLed(x: number, y: number, rgb: Rgb): void {
    const { ctx } = this;
    const on = rgb.r + rgb.g + rgb.b > 0;
    if (on) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 4.2);
      glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
      glow.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.fillStyle = on ? `rgb(${rgb.r},${rgb.g},${rgb.b})` : '#243044';
    ctx.arc(x, y, 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.28;
    ctx.stroke();
  }

  // --- sensor overlays -----------------------------------------------------

  private drawUltrasonicOverlay(robot: Robot): void {
    const { ctx } = this;
    const reading = robot.ultrasonic;
    if (reading.rays.length === 0) return;

    ctx.save();

    // Cone fill: outer edges of the ray fan.
    const first = reading.rays[0];
    const last = reading.rays[reading.rays.length - 1];
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = COLORS.overlay;
    ctx.beginPath();
    ctx.moveTo(first.origin.x, first.origin.y);
    for (const ray of reading.rays) ctx.lineTo(ray.end.x, ray.end.y);
    ctx.lineTo(last.origin.x, last.origin.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Individual rays.
    ctx.lineWidth = 0.35;
    for (const ray of reading.rays) {
      ctx.strokeStyle = ray.hit ? 'rgba(224,70,63,0.55)' : 'rgba(0,163,163,0.5)';
      ctx.beginPath();
      ctx.moveTo(ray.origin.x, ray.origin.y);
      ctx.lineTo(ray.end.x, ray.end.y);
      ctx.stroke();
    }

    // Hit marker and measured distance.
    if (reading.hitPoint && reading.distanceCm > 0) {
      ctx.fillStyle = COLORS.overlayHit;
      ctx.beginPath();
      ctx.arc(reading.hitPoint.x, reading.hitPoint.y, 1.6, 0, Math.PI * 2);
      ctx.fill();

      const midX = (robot.ultrasonicOrigin.x + reading.hitPoint.x) / 2;
      const midY = (robot.ultrasonicOrigin.y + reading.hitPoint.y) / 2;
      const label = `${reading.distanceCm.toFixed(1)} cm`;
      ctx.font = 'bold 5.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width + 3;
      ctx.fillStyle = 'rgba(17,24,39,0.86)';
      roundRect(ctx, midX - w / 2, midY - 4, w, 8, 1.6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, midX, midY);
    }

    ctx.restore();
  }

  private drawLineSensorOverlay(robot: Robot): void {
    const { ctx } = this;
    const sensors: [{ x: number; y: number }, boolean, string][] = [
      [robot.leftLineSensorPos, robot.leftOnLine, 'L'],
      [robot.rightLineSensorPos, robot.rightOnLine, 'R'],
    ];

    ctx.save();
    for (const [pos, onLine, label] of sensors) {
      ctx.beginPath();
      ctx.fillStyle = onLine ? COLORS.sensorOn : COLORS.sensorOff;
      ctx.arc(pos.x, pos.y, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // A letter plus a filled/hollow ring, so the state does not rely on
      // colour alone.
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 2.2px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);

      if (!onLine) {
        ctx.strokeStyle = COLORS.sensorOff;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3.1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawFootprint(robot: Robot): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(43,108,176,0.45)';
    ctx.lineWidth = 0.4;
    ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath();
    ctx.arc(robot.pose.x, robot.pose.y, ROBOT.radiusCm, 0, Math.PI * 2);
    ctx.stroke();

    // Heading tick.
    const nose = toWorld(robot.pose, robot.pose.heading, { x: ROBOT.radiusCm + 3, y: 0 });
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(robot.pose.x, robot.pose.y);
    ctx.lineTo(nose.x, nose.y);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
