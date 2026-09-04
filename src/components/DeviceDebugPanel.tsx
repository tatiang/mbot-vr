import { useState } from 'react';
import type { DeviceSession } from '../device/DeviceSession';
import { MotorPort, decodeFloatLE } from '../device/MakeblockProtocol';
import type { DeviceCapabilities } from '../device/capabilities';
import type { ConnectionStatus } from '../device/types';

interface Props {
  capabilities: DeviceCapabilities;
  status: ConnectionStatus;
  session: DeviceSession | null;
  /** The same escalation-ladder stop the main STOP button uses - never a separate path. */
  onStop: () => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A brief, conservative pulse - matches the bench-test checklist's "speed ~40" step. */
const TEST_SPEED = 60;
const TEST_PULSE_MS = 600;

/**
 * Raw protocol/connection internals for whoever is bringing up a new robot or module,
 * never for students. Rendered only behind `?debug=1` (`isHardwareDebugEnabled()`) -
 * see `docs/hardware-bridge-plan.md`'s Bluetooth LE section for why per-actuator test
 * buttons matter before trusting "Run on robot": they isolate the transport/protocol
 * layer from block-compilation bugs, one actuator at a time, exactly the order the
 * physical-hardware testing checklist there specifies.
 */
export function DeviceDebugPanel({ capabilities, status, session, onStop }: Props) {
  const [lastResult, setLastResult] = useState<string>('-');

  const run = async (label: string, action: () => Promise<void>) => {
    setLastResult(`${label}...`);
    try {
      await action();
      setLastResult(`${label}: ok`);
    } catch (error) {
      setLastResult(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const testMotor = (port: number, label: string) =>
    run(label, async () => {
      if (!session) throw new Error('not connected');
      await session.setMotor(port, TEST_SPEED);
      await wait(TEST_PULSE_MS);
      await session.setMotor(port, 0);
    });

  const testBothMotors = () =>
    run('Test both motors', async () => {
      if (!session) throw new Error('not connected');
      await Promise.all([session.setMotor(MotorPort.LEFT, TEST_SPEED), session.setMotor(MotorPort.RIGHT, TEST_SPEED)]);
      await wait(TEST_PULSE_MS);
      await Promise.all([session.setMotor(MotorPort.LEFT, 0), session.setMotor(MotorPort.RIGHT, 0)]);
    });

  const readUltrasonic = () =>
    run('Read ultrasonic', async () => {
      if (!session) throw new Error('not connected');
      const payload = await session.getUltrasonicPayload();
      setLastResult(`Ultrasonic: ${decodeFloatLE(payload).toFixed(1)} cm`);
    });

  const stats = session?.getStats();
  const profile = 'profile' in status ? status.profile : null;

  return (
    <div className="device-debug-panel">
      <p className="hint-text" style={{ textAlign: 'left' }}>
        Raw connection tests. Not part of the student flow - reachable only via{' '}
        <code>?debug=1</code>.
      </p>
      <dl className="device-debug-panel__stats">
        <dt>Web Serial supported</dt>
        <dd>{String(capabilities.usbAvailable)}</dd>
        <dt>Web Bluetooth supported</dt>
        <dd>{String(capabilities.bleAvailable)}</dd>
        <dt>Runtime state</dt>
        <dd>{status.phase}</dd>
        <dt>Link</dt>
        <dd>{'link' in status ? status.link : '-'}</dd>
        <dt>Firmware version</dt>
        <dd>{profile?.firmwareVersion ?? '-'}</dd>
        <dt>Player firmware</dt>
        <dd>{String(profile?.supportsOnRobotPrograms ?? false)}</dd>
        <dt>Packets sent</dt>
        <dd>{stats?.packetsSent ?? '-'}</dd>
        <dt>Packets received</dt>
        <dd>{stats?.packetsReceived ?? '-'}</dd>
        <dt>Last result</dt>
        <dd>{lastResult}</dd>
      </dl>
      <div className="device-debug-panel__buttons">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!session}
          onClick={() => void testMotor(MotorPort.LEFT, 'Test left motor')}
        >
          Test Left Motor
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!session}
          onClick={() => void testMotor(MotorPort.RIGHT, 'Test right motor')}
        >
          Test Right Motor
        </button>
        <button type="button" className="btn btn--sm" disabled={!session} onClick={() => void testBothMotors()}>
          Test Both Motors
        </button>
        <button type="button" className="btn btn--sm btn--stop" onClick={onStop}>
          STOP
        </button>
        <button type="button" className="btn btn--sm" disabled={!session} onClick={() => void readUltrasonic()}>
          Read Ultrasonic
        </button>
      </div>
    </div>
  );
}
