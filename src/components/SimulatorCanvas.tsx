import { useEffect, useRef, useState } from 'react';
import type { Arena, Obstacle, LinePath, Vec2 } from '../types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import {
  Renderer,
  ROTATE_HANDLE_RADIUS_CM,
  rotateHandlePosition,
} from '../simulation/Renderer';
import { ROBOT } from '../simulation/constants';
import { makeId } from '../utils/id';
import { distanceToSegment, pointInRect } from '../utils/geometry';

export type EditorTool = 'select' | 'wall' | 'block' | 'line' | 'erase' | 'start';

interface Props {
  engine: SimulationEngine;
  showDistanceSensor: boolean;
  showLineSensors: boolean;
  showGrid: boolean;
  /** Null when the current playground is not editable. */
  tool: EditorTool | null;
  snapToGrid: boolean;
  programRunning: boolean;
  onArenaChange: (arena: Arena) => void;
  /**
   * Commits a robot's pose as its new start, once a drag or rotate finishes.
   * Fired on pointer-up rather than per-move so a single drag produces one
   * project change, not hundreds.
   */
  onStartPoseCommit: (which: 'robot' | 'opponent') => void;
}

type DragState =
  | { kind: 'robot' }
  | { kind: 'robotRotate' }
  | { kind: 'opponent' }
  | { kind: 'opponentRotate' }
  | { kind: 'rect'; start: Vec2; current: Vec2; obstacle: 'wall' | 'block' }
  | { kind: 'line'; points: Vec2[] }
  | null;

const SNAP_CM = 10;
const LINE_SAMPLE_CM = 4;

/**
 * The playground view.
 *
 * Drawing happens on every simulation frame straight from the engine; React
 * state here only tracks pointer interaction, which changes rarely.
 */
export function SimulatorCanvas({
  engine,
  showDistanceSensor,
  showLineSensors,
  showGrid,
  tool,
  snapToGrid,
  programRunning,
  onArenaChange,
  onStartPoseCommit,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const dragRef = useRef<DragState>(null);
  const [hoveringRobot, setHoveringRobot] = useState(false);
  const [hoveringOpponent, setHoveringOpponent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggingOpponent, setDraggingOpponent] = useState(false);

  // Props the render loop needs, held in a ref so changing them does not tear
  // down and rebuild the loop.
  const renderPropsRef = useRef({
    showDistanceSensor,
    showLineSensors,
    showGrid,
    hoveringRobot,
    dragging,
    hoveringOpponent,
    draggingOpponent,
    programRunning,
  });
  renderPropsRef.current = {
    showDistanceSensor,
    showLineSensors,
    showGrid,
    hoveringRobot,
    dragging,
    hoveringOpponent,
    draggingOpponent,
    programRunning,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    const applySize = () => {
      const rect = wrap.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, engine.arena);
    };
    applySize();

    const observer = new ResizeObserver(applySize);
    observer.observe(wrap);

    const unsubscribe = engine.subscribeFrame(() => {
      const props = renderPropsRef.current;
      renderer.draw(engine, {
        showDistanceSensor: props.showDistanceSensor,
        showLineSensors: props.showLineSensors,
        showGrid: props.showGrid,
        hoveringRobot: props.hoveringRobot,
        dragging: props.dragging,
        hoveringOpponent: props.hoveringOpponent,
        draggingOpponent: props.draggingOpponent,
        // Handles set the *start* pose, which only makes sense while stopped.
        showHandles: !props.programRunning,
      });
      paintEditorPreview(renderer, dragRef.current);
    });

    return () => {
      observer.disconnect();
      unsubscribe();
      rendererRef.current = null;
    };
  }, [engine]);

  // The camera has to be recomputed when the arena's size changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    const renderer = rendererRef.current;
    if (!wrap || !renderer) return;
    const rect = wrap.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, engine.arena);
  }, [engine, engine.arena]);

  // --- pointer handling ----------------------------------------------------

  const toWorld = (event: React.PointerEvent<HTMLCanvasElement>): Vec2 | null => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  };

  const snap = (p: Vec2): Vec2 =>
    snapToGrid
      ? { x: Math.round(p.x / SNAP_CM) * SNAP_CM, y: Math.round(p.y / SNAP_CM) * SNAP_CM }
      : p;

  const isOverRobot = (p: Vec2): boolean =>
    Math.hypot(p.x - engine.robot.pose.x, p.y - engine.robot.pose.y) <= ROBOT.radiusCm + 2;

  /** Only the student-placed practice opponent can be picked up; a scripted
   * Battle Bot opponent drives on its own and dragging it would fight that. */
  const canGrabOpponent = (): boolean => engine.opponentIsParked && Boolean(engine.opponent);

  const isOverOpponent = (p: Vec2): boolean =>
    canGrabOpponent() &&
    Math.hypot(p.x - engine.opponent!.pose.x, p.y - engine.opponent!.pose.y) <= ROBOT.radiusCm + 2;

  const isOverHandle = (p: Vec2, pose: { x: number; y: number; heading: number }): boolean => {
    const handle = rotateHandlePosition(pose.x, pose.y, pose.heading);
    // A little slack beyond the drawn circle, so it is grabbable on a laptop
    // trackpad without demanding pixel accuracy.
    return Math.hypot(p.x - handle.x, p.y - handle.y) <= ROTATE_HANDLE_RADIUS_CM + 1.5;
  };

  /** Angle from a robot's centre to the pointer - the heading a rotate sets. */
  const headingToward = (p: Vec2, centre: { x: number; y: number }): number =>
    Math.atan2(p.y - centre.y, p.x - centre.x);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event);
    if (!world) return;

    // Arena editing takes priority when a build tool is selected.
    if (tool && tool !== 'select') {
      event.currentTarget.setPointerCapture(event.pointerId);
      startEditorDrag(world);
      return;
    }

    if (programRunning) return;

    const grab = (kind: NonNullable<DragState>['kind']) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { kind } as DragState;
    };

    // Handles are tested before bodies: they sit outside the chassis, but the
    // player's handle can overlap the opponent's body when they are close.
    if (hoveringRobot && isOverHandle(world, engine.robot.pose)) {
      grab('robotRotate');
      setDragging(true);
      engine.setRobotHeading(headingToward(world, engine.robot.pose));
      return;
    }
    if (canGrabOpponent() && hoveringOpponent && isOverHandle(world, engine.opponent!.pose)) {
      grab('opponentRotate');
      setDraggingOpponent(true);
      engine.setOpponentHeading(headingToward(world, engine.opponent!.pose));
      return;
    }

    if (isOverRobot(world)) {
      grab('robot');
      setDragging(true);
      engine.moveRobotTo(world.x, world.y);
      return;
    }

    if (isOverOpponent(world)) {
      grab('opponent');
      setDraggingOpponent(true);
      engine.moveOpponentTo(world.x, world.y);
    }
  };

  const startEditorDrag = (world: Vec2) => {
    switch (tool) {
      case 'wall':
      case 'block': {
        const start = snap(world);
        dragRef.current = { kind: 'rect', start, current: start, obstacle: tool };
        setDragging(true);
        break;
      }
      case 'line':
        dragRef.current = { kind: 'line', points: [world] };
        setDragging(true);
        break;
      case 'erase':
        eraseAt(world);
        break;
      case 'start':
        onArenaChange({
          ...engine.arena,
          start: { ...engine.arena.start, x: world.x, y: world.y },
        });
        break;
      default:
        break;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event);
    if (!world) return;

    const drag = dragRef.current;
    if (!drag) {
      const selectable = !programRunning && (!tool || tool === 'select');
      // Hovering counts for the handle too, so it stays visible while the
      // pointer travels out to grab it.
      const overRobot =
        selectable && (isOverRobot(world) || (hoveringRobot && isOverHandle(world, engine.robot.pose)));
      setHoveringRobot(overRobot);
      // The robot takes priority when both overlap; only test the opponent
      // once we know the pointer is not already over the player's robot.
      const overOpponent =
        !overRobot &&
        selectable &&
        (isOverOpponent(world) ||
          (hoveringOpponent && canGrabOpponent() && isOverHandle(world, engine.opponent!.pose)));
      setHoveringOpponent(overOpponent);
      return;
    }

    if (drag.kind === 'robot') {
      engine.moveRobotTo(world.x, world.y);
    } else if (drag.kind === 'robotRotate') {
      engine.setRobotHeading(headingToward(world, engine.robot.pose));
    } else if (drag.kind === 'opponent') {
      engine.moveOpponentTo(world.x, world.y);
    } else if (drag.kind === 'opponentRotate' && engine.opponent) {
      engine.setOpponentHeading(headingToward(world, engine.opponent.pose));
    } else if (drag.kind === 'rect') {
      drag.current = snap(world);
    } else if (drag.kind === 'line') {
      const last = drag.points[drag.points.length - 1];
      // Sample sparsely so a slow drag does not produce thousands of points.
      if (Math.hypot(world.x - last.x, world.y - last.y) >= LINE_SAMPLE_CM) {
        drag.points.push(world);
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setDraggingOpponent(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag) return;

    // Moving or turning a robot while stopped *is* how you set its start pose,
    // so commit it once the drag ends.
    if (drag.kind === 'robot' || drag.kind === 'robotRotate') {
      onStartPoseCommit('robot');
      return;
    }
    if (drag.kind === 'opponent' || drag.kind === 'opponentRotate') {
      onStartPoseCommit('opponent');
      return;
    }

    if (drag.kind === 'rect') {
      const x = Math.min(drag.start.x, drag.current.x);
      const y = Math.min(drag.start.y, drag.current.y);
      const width = Math.abs(drag.current.x - drag.start.x);
      const height = Math.abs(drag.current.y - drag.start.y);
      // Ignore accidental taps that would create an invisible sliver.
      if (width < 4 || height < 4) return;
      const obstacle: Obstacle = {
        id: makeId(drag.obstacle),
        kind: drag.obstacle,
        x,
        y,
        width,
        height,
      };
      onArenaChange({ ...engine.arena, obstacles: [...engine.arena.obstacles, obstacle] });
    }

    if (drag.kind === 'line' && drag.points.length > 1) {
      const path: LinePath = { id: makeId('line'), points: drag.points, width: 3.6, closed: false };
      onArenaChange({ ...engine.arena, lines: [...engine.arena.lines, path] });
    }
  };

  const eraseAt = (world: Vec2) => {
    const arena = engine.arena;

    const obstacle = [...arena.obstacles].reverse().find((o) => pointInRect(world, o));
    if (obstacle) {
      onArenaChange({ ...arena, obstacles: arena.obstacles.filter((o) => o.id !== obstacle.id) });
      return;
    }

    const path = [...arena.lines].reverse().find((l) => pointNearPath(world, l));
    if (path) {
      onArenaChange({ ...arena, lines: arena.lines.filter((l) => l.id !== path.id) });
    }
  };

  const cursorClass =
    dragging || draggingOpponent
      ? 'sim__canvas--grabbing'
      : tool && tool !== 'select'
        ? 'sim__canvas--draw'
        : hoveringRobot || hoveringOpponent
          ? 'sim__canvas--grab'
          : '';

  return (
    <div className="sim" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={`sim__canvas ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          setHoveringRobot(false);
          setHoveringOpponent(false);
        }}
        role="img"
        aria-label={`${engine.arena.name} playground with the virtual mBot`}
      />
      <p className="sim__hint">
        {tool && tool !== 'select'
          ? editorHint(tool)
          : programRunning
            ? 'Program running - press Stop to move either robot by hand.'
            : engine.opponentIsParked
              ? 'Drag either robot to move it, or its round handle to turn it. That sets where Reset puts it.'
              : 'Drag the robot to move it, or its round handle to turn it. That sets where Reset puts it.'}
      </p>
    </div>
  );
}

function editorHint(tool: EditorTool): string {
  switch (tool) {
    case 'wall':
      return 'Drag to draw a wall.';
    case 'block':
      return 'Drag to draw a box.';
    case 'line':
      return 'Drag to paint a black line.';
    case 'erase':
      return 'Click a wall, box or line to remove it.';
    case 'start':
      return 'Click to move the start position.';
    default:
      return '';
  }
}

function pointNearPath(point: Vec2, path: LinePath): boolean {
  const threshold = path.width / 2 + 3;
  for (let i = 0; i < path.points.length - 1; i += 1) {
    if (distanceToSegment(point, path.points[i], path.points[i + 1]) <= threshold) return true;
  }
  return false;
}

/** Draws the in-progress wall/box rectangle or freehand line. */
function paintEditorPreview(renderer: Renderer, drag: DragState): void {
  if (!drag || drag.kind === 'robot') return;

  renderer.withWorldTransform((ctx) => {
    if (drag.kind === 'rect') {
      const x = Math.min(drag.start.x, drag.current.x);
      const y = Math.min(drag.start.y, drag.current.y);
      const w = Math.abs(drag.current.x - drag.start.x);
      const h = Math.abs(drag.current.y - drag.start.y);
      ctx.fillStyle = drag.obstacle === 'wall' ? 'rgba(124,135,155,0.5)' : 'rgba(240,160,75,0.5)';
      ctx.strokeStyle = '#1f5fbf';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 2]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    } else if (drag.kind === 'line' && drag.points.length > 1) {
      ctx.strokeStyle = 'rgba(20,24,31,0.7)';
      ctx.lineWidth = 3.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(drag.points[0].x, drag.points[0].y);
      for (const p of drag.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  });
}
