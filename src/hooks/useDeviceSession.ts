import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceSession } from '../device/DeviceSession';
import { openSerialLink, requestSerialPort } from '../device/SerialTransport';
import { detectCapabilities, type DeviceCapabilities } from '../device/capabilities';
import { stopRobot } from '../device/StopController';
import type { ConnectionStatus, LinkKind, StopOutcome } from '../device/types';
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog';
import { classifyError } from '../diagnostics/taxonomy';

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

export function useDeviceSession(log: DiagnosticLog): DeviceSessionController {
  const capabilities = useRef(detectCapabilities()).current;
  const [status, setStatus] = useState<ConnectionStatus>(
    capabilities.usbAvailable && capabilities.secureContext ? { phase: 'disconnected' } : { phase: 'unsupported' },
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
        const port = await requestSerialPort(kind, options);
        setStatus({ phase: 'opening', link: kind });
        const link = await openSerialLink(port);
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
