import type { Arena } from '../types';
import type { EditorTool } from './SimulatorCanvas';
import { ToggleButton } from './ui';
import { FREE_BUILD_LAYOUTS, freeBuildLayoutById } from '../playgrounds/freeBuildLayouts';

const TOOLS: { id: EditorTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Drag the robot to move it' },
  { id: 'wall', label: 'Add wall', hint: 'Drag out a grey wall' },
  { id: 'block', label: 'Add box', hint: 'Drag out an orange box' },
  { id: 'line', label: 'Draw line', hint: 'Drag to paint black tape' },
  { id: 'erase', label: 'Erase', hint: 'Click something to remove it' },
  { id: 'start', label: 'Set start', hint: 'Click to move the start position' },
];

/**
 * Build tools for the Free Build playground.
 *
 * Deliberately small: rectangles, freehand tape, an eraser and a start marker
 * cover every course a class actually asks for, without turning into a CAD app.
 */
export function ArenaEditor({
  arena,
  tool,
  snap,
  onToolChange,
  onSnapChange,
  onArenaChange,
}: {
  arena: Arena;
  tool: EditorTool;
  snap: boolean;
  onToolChange: (tool: EditorTool) => void;
  onSnapChange: (snap: boolean) => void;
  onArenaChange: (arena: Arena) => void;
}) {
  const clearAll = () => {
    // Keep the room's outer walls: without them the robot drives off screen and
    // students think the app is broken.
    onArenaChange({
      ...arena,
      obstacles: arena.obstacles.filter((o) => o.kind === 'wall' && isBorder(o, arena)),
      lines: [],
    });
  };

  return (
    <div className="tools">
      {TOOLS.map((entry) => (
        <ToggleButton
          key={entry.id}
          pressed={tool === entry.id}
          onToggle={() => onToolChange(entry.id)}
          title={entry.hint}
        >
          {entry.label}
        </ToggleButton>
      ))}
      <ToggleButton pressed={snap} onToggle={() => onSnapChange(!snap)} title="Snap to a 10 cm grid">
        Snap 10 cm
      </ToggleButton>
      <button type="button" className="btn btn--sm" onClick={clearAll}>
        Clear course
      </button>

      <label className="field" style={{ marginLeft: 'auto' }}>
        <span className="field__label">Layout</span>
        <select
          className="select"
          value=""
          aria-label="Load a preset starting layout"
          onChange={(event) => {
            const layout = freeBuildLayoutById(event.target.value);
            if (layout) onArenaChange(layout.apply(arena));
            event.target.value = '';
          }}
        >
          <option value="" disabled>
            Load a starting layout...
          </option>
          {FREE_BUILD_LAYOUTS.map((entry) => (
            <option key={entry.id} value={entry.id} title={entry.description}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function isBorder(obstacle: { x: number; y: number; width: number; height: number }, arena: Arena) {
  const touchesEdge =
    obstacle.x <= 0.01 ||
    obstacle.y <= 0.01 ||
    obstacle.x + obstacle.width >= arena.widthCm - 0.01 ||
    obstacle.y + obstacle.height >= arena.heightCm - 0.01;
  const spansFully =
    obstacle.width >= arena.widthCm - 0.01 || obstacle.height >= arena.heightCm - 0.01;
  return touchesEdge && spansFully;
}
