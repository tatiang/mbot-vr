import type { RunState } from '../types';
import { SPEED_OPTIONS } from '../simulation/constants';
import {
  EyeIcon,
  GridIcon,
  LineSensorIcon,
  PlayIcon,
  ResetIcon,
  SparkIcon,
  StopIcon,
} from './icons';
import { ToggleButton } from './ui';

interface Props {
  runState: RunState;
  /**
   * Whether there is anything for Stop to act on. That is not the same as
   * "a program is running": a program that ended without `stop moving` leaves
   * the robot driving, and Stop has to be able to cut it.
   */
  canStop: boolean;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  showDistanceSensor: boolean;
  onToggleDistanceSensor: () => void;
  showLineSensors: boolean;
  onToggleLineSensors: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  highlightBlocks: boolean;
  onToggleHighlight: () => void;
  statusText: string;
}

/** The always-visible transport controls. */
export function RunBar({
  runState,
  canStop,
  onRun,
  onStop,
  onReset,
  speed,
  onSpeedChange,
  showDistanceSensor,
  onToggleDistanceSensor,
  showLineSensors,
  onToggleLineSensors,
  showGrid,
  onToggleGrid,
  highlightBlocks,
  onToggleHighlight,
  statusText,
}: Props) {
  const running = runState === 'running';

  return (
    <footer className="runbar">
      <div className="runbar__group">
        <button
          type="button"
          className="btn btn--run"
          onClick={onRun}
          disabled={running}
          title="Run the program (Ctrl/Cmd + Enter)"
        >
          <PlayIcon size={16} /> Run
        </button>
        <button
          type="button"
          className="btn btn--stop"
          onClick={onStop}
          disabled={!canStop}
          title="Stop the program and cut the motors (Esc)"
        >
          <StopIcon size={16} /> Stop
        </button>
        <button type="button" className="btn btn--reset" onClick={onReset} title="Send the robot back to the start">
          <ResetIcon size={16} /> Reset
        </button>
      </div>

      <div className="runbar__status" aria-live="polite">
        {running && <span className="pulse" aria-hidden="true" />}
        {statusText}
      </div>

      <div className="runbar__spacer" />

      <div className="runbar__group">
        <ToggleButton
          pressed={showDistanceSensor}
          onToggle={onToggleDistanceSensor}
          title="Draw the ultrasonic sensor's cone, what it hit, and the distance it measured"
        >
          <EyeIcon size={15} /> Distance
        </ToggleButton>
        <ToggleButton
          pressed={showLineSensors}
          onToggle={onToggleLineSensors}
          title="Draw the two line sensors, whether each is on the line, and the collision outline"
        >
          <LineSensorIcon size={15} /> Line
        </ToggleButton>
        <ToggleButton pressed={showGrid} onToggle={onToggleGrid} title="Show the measuring grid">
          <GridIcon size={15} /> Grid
        </ToggleButton>
        <ToggleButton
          pressed={highlightBlocks}
          onToggle={onToggleHighlight}
          title="Highlight each block as it runs"
        >
          <SparkIcon size={15} /> Highlight
        </ToggleButton>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="speed-select">
          Speed
        </label>
        <select
          id="speed-select"
          className="select"
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        >
          {SPEED_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}x
            </option>
          ))}
        </select>
      </div>
    </footer>
  );
}
