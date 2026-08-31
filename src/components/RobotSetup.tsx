import { PHYSICS } from '../simulation/RobotPhysics';

interface Props {
  robotMassKg: number;
  opponentMassKg: number;
  /** False when no second robot is in the arena, which hides its control. */
  hasOpponent: boolean;
  onRobotMassChange: (massKg: number) => void;
  onOpponentMassChange: (massKg: number) => void;
  onRestoreStartPoses: () => void;
  disabled: boolean;
}

/**
 * Mass controls and a start-pose escape hatch.
 *
 * Mass only matters when two robots meet: the drive model is speed-controlled,
 * so a heavier robot does not accelerate more slowly, but it does grip harder
 * and therefore both shove better and resist being shoved. The panel says so,
 * because otherwise a student would reasonably expect the heavy robot to be
 * sluggish.
 */
export function RobotSetup({
  robotMassKg,
  opponentMassKg,
  hasOpponent,
  onRobotMassChange,
  onOpponentMassChange,
  onRestoreStartPoses,
  disabled,
}: Props) {
  return (
    <div className="setup">
      <MassField
        id="robot-mass"
        label="Your mBot"
        value={robotMassKg}
        onChange={onRobotMassChange}
        disabled={disabled}
      />

      {hasOpponent && (
        <MassField
          id="opponent-mass"
          label="Opponent"
          value={opponentMassKg}
          onChange={onOpponentMassChange}
          disabled={disabled}
        />
      )}

      <p className="hint-text" style={{ padding: '2px 0 8px', textAlign: 'left' }}>
        A standard mBot build is about {PHYSICS.defaultMassKg} kg. Weight decides who wins a
        pushing contest - it does not change how fast a robot drives.
      </p>

      <button type="button" className="btn btn--sm" onClick={onRestoreStartPoses}>
        Restore default start positions
      </button>
    </div>
  );
}

function MassField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (massKg: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="setup__row">
      <label className="setup__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="setup__slider"
        min={PHYSICS.minMassKg}
        max={PHYSICS.maxMassKg}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        type="number"
        className="text-input setup__number"
        aria-label={`${label} mass in kilograms`}
        min={PHYSICS.minMassKg}
        max={PHYSICS.maxMassKg}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="setup__unit">kg</span>
    </div>
  );
}
