import type { ReactNode } from 'react';
import type { RobotTelemetry } from '../types';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import { useEngineSample } from '../hooks/useEngineSample';
import { MOTOR_MAX } from '../utils/units';

/**
 * Live telemetry.
 *
 * This is the feature that makes the simulator genuinely better than a real
 * mBot in upload mode: on hardware there is no way to watch a sensor while the
 * program runs, so students guess. Here every value is on screen as it changes.
 */
export function SensorMonitor({ engine }: { engine: SimulationEngine }) {
  const t = useEngineSample(engine, (e) => e.getTelemetry(), 10);

  return (
    <div className="telemetry">
      <Readout label="Ultrasonic">
        {t.ultrasonicCm === 0 ? (
          <>
            <span className="readout__value readout__value--sm">nothing</span>
            <span className="readout__unit">in range</span>
          </>
        ) : (
          <>
            <span className="readout__value">{t.ultrasonicCm.toFixed(1)}</span>
            <span className="readout__unit">cm</span>
          </>
        )}
        <Bar value={t.ultrasonicCm === 0 ? 0 : 1 - Math.min(t.ultrasonicCm, 60) / 60} />
      </Readout>

      <Readout label="Line follower">
        <span className="readout__value">{t.lineValue}</span>
        <span className="readout__unit">{lineValueWord(t.lineValue)}</span>
      </Readout>

      <SensorStateReadout label="Left sensor" onLine={t.leftOnLine} />
      <SensorStateReadout label="Right sensor" onLine={t.rightOnLine} />

      <MotorReadout label="Left motor" value={t.leftMotor} />
      <MotorReadout label="Right motor" value={t.rightMotor} />

      <Readout label="Heading">
        <span className="readout__value">{t.headingDeg}</span>
        <span className="readout__unit">deg</span>
      </Readout>

      <Readout label="Position">
        <span className="readout__value readout__value--sm">
          {t.x.toFixed(0)}, {t.y.toFixed(0)}
        </span>
        <span className="readout__unit">cm</span>
      </Readout>

      <Readout label="Display">
        <span className="seven-seg">{t.display.trim() === '' ? ' ' : t.display}</span>
      </Readout>

      <Readout label="Onboard LEDs">
        <div className="led-row">
          <LedSwatch rgb={t.ledLeft} label="L" />
          <LedSwatch rgb={t.ledRight} label="R" />
        </div>
      </Readout>

      <Readout label="Distance">
        <span className="readout__value">{t.distanceTravelledCm}</span>
        <span className="readout__unit">cm</span>
      </Readout>
    </div>
  );
}

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="readout">
      <p className="readout__label">{label}</p>
      {children}
    </div>
  );
}

/**
 * Sensor state is shown three ways at once - a word, a filled/hollow dot and a
 * background tint - so it never depends on colour alone.
 */
function SensorStateReadout({ label, onLine }: { label: string; onLine: boolean }) {
  return (
    <div className={`readout ${onLine ? 'readout--on' : 'readout--off'}`}>
      <p className="readout__label">{label}</p>
      <span className={`state-chip ${onLine ? 'state-chip--on' : 'state-chip--off'}`}>
        <span className="state-chip__dot" />
        {onLine ? 'ON LINE' : 'OFF LINE'}
      </span>
    </div>
  );
}

function MotorReadout({ label, value }: { label: string; value: number }) {
  const magnitude = Math.abs(value) / MOTOR_MAX;
  return (
    <div className="readout">
      <p className="readout__label">{label}</p>
      <span className="readout__value">{value}</span>
      <span className="readout__unit">{value === 0 ? 'stopped' : value > 0 ? 'fwd' : 'rev'}</span>
      <Bar value={magnitude} negative={value < 0} />
    </div>
  );
}

function Bar({ value, negative = false }: { value: number; negative?: boolean }) {
  const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return (
    <div className="bar" aria-hidden="true">
      <div className={`bar__fill${negative ? ' bar__fill--neg' : ''}`} style={{ width }} />
    </div>
  );
}

function LedSwatch({ rgb, label }: { rgb: RobotTelemetry['ledLeft']; label: string }) {
  const off = rgb.r + rgb.g + rgb.b === 0;
  return (
    <span className="led-label" title={off ? 'off' : `R${rgb.r} G${rgb.g} B${rgb.b}`}>
      <span
        className="led-swatch"
        style={{
          background: off ? 'transparent' : `rgb(${rgb.r},${rgb.g},${rgb.b})`,
          backgroundImage: off
            ? 'linear-gradient(45deg, transparent 46%, #b6c0d0 46%, #b6c0d0 54%, transparent 54%)'
            : 'none',
        }}
      />{' '}
      {label} {off ? 'off' : 'on'}
    </span>
  );
}

function lineValueWord(value: number): string {
  switch (value) {
    case 0:
      return 'both on';
    case 1:
      return 'left on';
    case 2:
      return 'right on';
    default:
      return 'both off';
  }
}
