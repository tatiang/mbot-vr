/**
 * Shared types for the physical-robot device layer.
 *
 * See `docs/hardware-bridge-plan.md` for the design this implements. Nothing in this
 * file, or anywhere under `src/device/` and `src/diagnostics/`, is imported by the
 * simulator path (`src/simulation/*`, `src/runtime/worker.ts`,
 * `src/blocks/generators.ts`) - that is deliberate, and it is what lets the hardware
 * feature stay behind a flag without risking the classroom app that already works.
 */

/** Which `MbotRuntime` a running program is driving. */
export type ExecutionTarget = 'simulator' | 'robot';

/** How the browser is talking to the robot. */
export type LinkKind = 'usb' | 'bluetooth';

/**
 * Everything the device layer knows about the robot on the other end of the link,
 * resolved once during `identifying` and held for the session. Absent fields mean
 * "not yet known" or "not configured" rather than "definitely not present" - a teacher
 * can always configure a port a preflight check currently blocks.
 */
export interface DeviceProfile {
  /** Teacher-assigned name, read from the robot's reserved EEPROM field when present. */
  nickname: string | null;
  firmwareVersion: string | null;
  protocolVersion: string | null;
  /** RJ25 port (1-4) the ultrasonic sensor answers on, or null if not confirmed. */
  ultrasonicPort: number | null;
  /** RJ25 port (1-4) the line-follower module answers on, or null if not confirmed. */
  lineFollowerPort: number | null;
  /** Whether a Me 7-Segment display module has been configured for this robot. */
  hasDisplay: boolean;
  displayPort: number | null;
}

/** A `DeviceProfile` with nothing resolved yet - the starting point for `identifying`. */
export const UNKNOWN_DEVICE_PROFILE: DeviceProfile = {
  nickname: null,
  firmwareVersion: null,
  protocolVersion: null,
  ultrasonicPort: null,
  lineFollowerPort: null,
  hasDisplay: false,
  displayPort: null,
};

/**
 * The connect/send/stop state machine from `docs/hardware-bridge-plan.md` §8, folded
 * into one discriminated union so a consumer can switch on `phase` and get the right
 * payload type for free.
 */
export type ConnectionStatus =
  | { phase: 'unsupported' }
  | { phase: 'disconnected' }
  | { phase: 'choosing' }
  | { phase: 'requestingPermission'; link: LinkKind }
  | { phase: 'opening'; link: LinkKind }
  | { phase: 'identifying'; link: LinkKind; attempt: number }
  | { phase: 'confirmingIdentity'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'ready'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'preflight'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'sending'; link: LinkKind; profile: DeviceProfile; sentBytes: number; totalBytes: number }
  | { phase: 'verifying'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'running'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'stopping'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'stopUnconfirmed'; link: LinkKind; profile: DeviceProfile }
  | { phase: 'linkLost'; link: LinkKind }
  | { phase: 'error'; code: string; link?: LinkKind };

export function isConnected(status: ConnectionStatus): boolean {
  return (
    status.phase === 'ready' ||
    status.phase === 'preflight' ||
    status.phase === 'sending' ||
    status.phase === 'verifying' ||
    status.phase === 'running' ||
    status.phase === 'stopping' ||
    status.phase === 'stopUnconfirmed'
  );
}

/** Severity of a preflight finding. See `docs/hardware-bridge-plan.md` §10. */
export type IssueSeverity = 'blocking' | 'warning' | 'note';

/** One thing preflight noticed about a workspace's fitness for a physical robot. */
export interface HardwareIssue {
  severity: IssueSeverity;
  /** The block responsible, so the workspace can highlight it. Absent for whole-program issues. */
  blockId?: string;
  blockType?: string;
  /** Student-facing, plain-language explanation. */
  message: string;
}

/** Outcome of the stop escalation ladder in `docs/hardware-bridge-plan.md` §9. */
export type StopOutcome = 'confirmed' | 'unconfirmed';

/**
 * Thrown by anything in the device layer that fails in a way the UI needs to explain.
 * `code` is one of the normalized taxonomy strings in `src/diagnostics/taxonomy.ts`
 * (kept as a plain string, not an imported type, so `src/device/*` does not have to
 * depend on `src/diagnostics/*` - either layer can be reasoned about on its own).
 */
export class DeviceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DeviceError';
    this.code = code;
  }
}
