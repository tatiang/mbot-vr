import { useCallback, useEffect, useRef, useState } from 'react';
import { openBleLink, requestBleDevice } from '../device/BluetoothLeTransport';
import { DeviceSession } from '../device/DeviceSession';
import { openSerialLink, requestSerialPort } from '../device/SerialTransport';
import { canOfferHardware, detectCapabilities, type DeviceCapabilities } from '../device/capabilities';
import { stopRobot } from '../device/StopController';
import type { ConnectionStatus, LinkKind, StopOutcome } from '../device/types';
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog';
import { classifyError } from '../diagnostics/taxonomy';
import type { SerialLink } from '../device/SerialTransport';

/**
 * React glue around `DeviceSession` - the browser-facing half (requesting a port,
 * opening it) that `DeviceSession` itself deliberately does not own, so that class can
 * be constructed and tested with a fake link with no browser involved at all (see
 * `src/device/DeviceSession.ts`).
 *
 * This is the only place in the app that calls `requestSerialPort`/`openSerialLink`,
 * matching the "one place, one flag check" rule in
 * `docs/hardware-bridge-plan.md` §15 - everything importing this hook only reaches the
 * device layer through it.
 */
export interface DeviceSessionController {
  status: ConnectionStatus;
  capabilities: DeviceCapabilities;
  connect: (kind: LinkKind, options?: { showAllPorts?: boolean }) => Promise<void>;
  confirmIdentity: () => void;
  rejectIdentity: () => void;
  disconnect: () => void;
  stop: () => Promise<StopOutcome>;
  wink: () => Promise<void>;
  acknowledgeStopUnconfirmed: () => void;
  /** The live session, for building a runtime against - null whenever nothing is connected. */
  getSession: () => DeviceSession | null;
}

/**
 * Arduino Uno-compatible boards - the mCore included - auto-reset when a serial
 * connection opens: the classic DTR-line-through-a-100nF-capacitor circuit that also
 * makes the Arduino IDE's own Serial Monitor reset a board on open. Web Serial's
 * `port.open()` goes through the same OS-level handshake, so it very likely triggers
 * the same reset here. This surfaced as a real, reproducible failure during hardware
 * testing: `identify()` kept timing out even after the reply-parsing bug (see
 * `docs/hardware-bridge-plan.md`) was fixed, consistent with probing a board that was
 * still rebooting. This grace period lets the reset and the bootloader's own startup
 * delay finish before the first probe goes out, rather than burning identify's first
 * attempt on a board that cannot answer yet.
 */
const RESET_SETTLE_MS = 2000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDeviceSession(log: DiagnosticLog): DeviceSessionController {
  const capabilities = useRef(detectCapabilities()).current;
  const [status, setStatus] = useState<ConnectionStatus>(
    canOfferHardware(capabilities) ? { phase: 'disconnected' } : { phase: 'unsupported' },
  );
  const sessionRef = useRef<DeviceSession | null>(null);

  useEffect(() => {
    // Close whatever is open if the app itself goes away - a stray open port would
    // otherwise outlive the component and keep the robot unreachable from mBlock too.
    return () => sessionRef.current?.dispose();
  }, []);

  const connect = useCallback(
    async (kind: LinkKind, options: { showAllPorts?: boolean } = {}) => {
      setStatus({ phase: 'requestingPermission', link: kind });
      try {
        let link: SerialLink;
        if (kind === 'ble') {
          const device = await requestBleDevice();
          setStatus({ phase: 'opening', link: kind });
          link = await openBleLink(device, (message) => log.log({ message }));
          // GATT has no DTR-line auto-reset to wait out - the board was never reset by
          // connecting, so there is nothing to settle before the first probe.
        } else {
          const port = await requestSerialPort(kind, options);
          setStatus({ phase: 'opening', link: kind });
          link = await openSerialLink(port);
          await wait(RESET_SETTLE_MS); // let a likely auto-reset finish - see the note above
        }
        const session = new DeviceSession(link, kind, {
          onStatusChange: setStatus,
          onLog: (event) => log.log(event),
        });
        sessionRef.current = session;
        await session.identify();
        await session.wink();
      } catch (error) {
        log.logError('Could not connect to a robot', error);
        // The port may already be open (e.g. identify() timed out after a successful
        // open) - release it now, or the *next* attempt fails with ERR_PORT_BUSY
        // against a port only this failed attempt is still holding.
        sessionRef.current?.dispose();
        sessionRef.current = null;
        const code = classifyError(error).code;
        setStatus({ phase: 'error', code, link: kind });
      }
    },
    [log],
  );

  const confirmIdentity = useCallback(() => {
    sessionRef.current?.confirmIdentity();
  }, []);

  const rejectIdentity = useCallback(() => {
    sessionRef.current?.rejectIdentity();
    sessionRef.current = null;
    setStatus({ phase: 'disconnected' });
  }, []);

  const disconnect = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setStatus({ phase: 'disconnected' });
  }, []);

  const wink = useCallback(async () => {
    await sessionRef.current?.wink();
  }, []);

  const stop = useCallback(async (): Promise<StopOutcome> => {
    const session = sessionRef.current;
    if (!session) return 'unconfirmed';
    return stopRobot(session, log);
  }, [log]);

  const acknowledgeStopUnconfirmed = useCallback(() => {
    sessionRef.current?.acknowledgeStopUnconfirmed();
  }, []);

  return {
    status,
    capabilities,
    connect,
    confirmIdentity,
    rejectIdentity,
    disconnect,
    stop,
    wink,
    acknowledgeStopUnconfirmed,
    getSession: () => sessionRef.current,
  };
}
