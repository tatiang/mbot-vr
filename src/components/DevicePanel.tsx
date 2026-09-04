import type { DeviceCapabilities } from '../device/capabilities';
import type { ConnectionStatus, LinkKind } from '../device/types';
import { RobotIcon } from './icons';

interface Props {
  status: ConnectionStatus;
  capabilities: DeviceCapabilities;
  onConnect: (kind: LinkKind, options?: { showAllPorts?: boolean }) => void;
  onConfirmIdentity: () => void;
  onRejectIdentity: () => void;
  onWinkAgain: () => void;
  onDisconnect: () => void;
  onRun: () => void;
  onStop: () => void;
  onStoreProgram: () => void;
  onClearStoredProgram: () => void;
  onCheckRobotInfo: () => void;
  running: boolean;
  runDisabled: boolean;
  runDisabledReason?: string;
  storeDisabled: boolean;
  clearDisabled: boolean;
  storeDisabledReason?: string;
  /** Whether the connected firmware supports Player's `INFO` query at all. */
  infoAvailable: boolean;
  /** `isWirelessFeatureEnabled()` - hides both Bluetooth connect options when false. */
  wirelessEnabled: boolean;
}

/**
 * The connect / identify / ready UI for "My robot" - a straight rendering of the
 * `ConnectionStatus` union from `docs/hardware-bridge-plan.md` §8, one branch per
 * phase. All the actual browser calls and state machine logic live in
 * `useDeviceSession` and `DeviceSession`; this component only reads `status` and
 * calls the callbacks it is given.
 */
export function DevicePanel({
  status,
  capabilities,
  onConnect,
  onConfirmIdentity,
  onRejectIdentity,
  onWinkAgain,
  onDisconnect,
  onRun,
  onStop,
  onStoreProgram,
  onClearStoredProgram,
  onCheckRobotInfo,
  running,
  runDisabled,
  runDisabledReason,
  storeDisabled,
  clearDisabled,
  storeDisabledReason,
  infoAvailable,
  wirelessEnabled,
}: Props) {
  switch (status.phase) {
    case 'unsupported':
      return (
        <div className="device-panel">
          <p className="hint-text" style={{ textAlign: 'left' }}>
            This browser can't talk to robots yet. Open mBot VR in <strong>Chrome or Edge</strong> to
            connect a physical mBot - everything else here works fine in this browser.
          </p>
        </div>
      );

    case 'disconnected':
    case 'error':
      return (
        <div className="device-panel">
          {status.phase === 'error' && (
            <p className="device-panel__error">Couldn't connect. Try again, or check Diagnostics below.</p>
          )}
          {!capabilities.secureContext && (
            <p className="hint-text" style={{ textAlign: 'left' }}>
              This page isn't loaded securely, so robots can't be reached from here.
            </p>
          )}
          <div className="device-panel__choices">
            {capabilities.usbAvailable && (
              <button type="button" className="btn" onClick={() => onConnect('usb')}>
                <RobotIcon size={15} /> Connect (via cable)
              </button>
            )}
            {wirelessEnabled && capabilities.bleAvailable && (
              <button type="button" className="btn btn--ghost" onClick={() => onConnect('ble')}>
                Connect Bluetooth
              </button>
            )}
          </div>
          {wirelessEnabled && (
            <p className="hint-text" style={{ textAlign: 'left' }}>
              Only driving the robot works wirelessly - uploading code to it needs the cable.
            </p>
          )}
          {capabilities.usbAvailable && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => onConnect('usb', { showAllPorts: true })}
            >
              Show all ports
            </button>
          )}
          {wirelessEnabled && capabilities.usbAvailable && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => onConnect('bluetooth')}>
              My robot's Bluetooth module is older
            </button>
          )}
        </div>
      );

    case 'requestingPermission':
      return <p className="device-panel__status">Waiting for you to pick a robot…</p>;

    case 'opening':
      return <p className="device-panel__status">Connecting…</p>;

    case 'identifying':
      return <p className="device-panel__status">Looking for a robot (try {status.attempt} of 3)…</p>;

    case 'confirmingIdentity':
      return (
        <div className="device-panel">
          <p className="device-panel__question">Confirm robot connected</p>
          <p className="hint-text" style={{ textAlign: 'left' }}>It should have flashed and beeped just now.</p>
          <div className="device-panel__choices">
            <button type="button" className="btn btn--primary" onClick={onConfirmIdentity}>
              Yes, that's mine
            </button>
            <button type="button" className="btn btn--ghost" onClick={onRejectIdentity}>
              No, try a different one
            </button>
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onWinkAgain}>
            Flash it again
          </button>
        </div>
      );

    case 'ready':
    case 'sending':
    case 'verifying':
    case 'running':
    case 'stopping':
    case 'stopUnconfirmed': {
      return (
        <div className="device-panel">
          <p className="device-panel__connected">
            <RobotIcon size={15} />{' '}
            {status.profile.nickname ? (
              <>
                Connected to <strong>{status.profile.nickname}</strong>
              </>
            ) : (
              'Connected to your robot'
            )}
          </p>
          <div className="device-panel__choices">
            <button type="button" className="btn btn--run" onClick={onRun} disabled={running || runDisabled}>
              Run on robot
            </button>
            <button type="button" className="btn btn--stop" onClick={onStop}>
              STOP
            </button>
          </div>
          {runDisabled && runDisabledReason && <p className="hint-text" style={{ textAlign: 'left' }}>{runDisabledReason}</p>}
          <div className="device-panel__storage">
            <button type="button" className="btn btn--primary" onClick={onStoreProgram} disabled={storeDisabled}>
              Upload to my robot
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClearStoredProgram} disabled={clearDisabled}>
              Clear robot's code
            </button>
          </div>
          {status.phase === 'sending' && (
            <div className="device-panel__progress" aria-label="Program transfer progress">
              <div style={{ width: `${Math.round((status.sentBytes / Math.max(1, status.totalBytes)) * 100)}%` }} />
            </div>
          )}
          {status.phase === 'verifying' && <p className="device-panel__status">Checking the program on the robot…</p>}
          {storeDisabledReason && <p className="hint-text" style={{ textAlign: 'left' }}>{storeDisabledReason}</p>}
          {infoAvailable && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onCheckRobotInfo}
              disabled={running || clearDisabled}
            >
              Check robot's code
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={onDisconnect} disabled={running}>
            Disconnect my robot
          </button>
        </div>
      );
    }

    case 'linkLost':
      return (
        <div className="device-panel">
          <p className="device-panel__error">Lost the robot. It may still be moving - check it.</p>
          <button type="button" className="btn" onClick={() => onConnect(status.link)}>
            Reconnect
          </button>
        </div>
      );

    default:
      return null;
  }
}
