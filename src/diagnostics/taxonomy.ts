/**
 * The normalized error taxonomy from `docs/hardware-bridge-plan.md` §11.
 *
 * Every failure in the device layer is mapped through `classifyError` to one of these
 * stable string codes before it reaches a student or the diagnostic log. The point is
 * decoupling: a wording change in a Chrome exception, or in this app's own error
 * messages, never changes a code a teacher has learned to recognise, and the log always
 * has something better to search on than free text.
 *
 * This module deliberately does not import anything from `src/device/*` - it takes
 * `unknown` and duck-types a `code` property, so the device layer and the diagnostics
 * layer can each be read on their own.
 */

export type ErrorCategory =
  | 'environment'
  | 'permission'
  | 'connection'
  | 'handshake'
  | 'safety'
  | 'program'
  | 'transfer'
  | 'firmware'
  | 'runtime'
  | 'fallback';

export interface TaxonomyEntry {
  code: string;
  category: ErrorCategory;
  /** Plain-language sentence a grade 4-8 student can act on. */
  studentMessage: string;
  /** Short imperative, shown behind "Technical details" alongside the raw message. */
  suggestedAction: string;
}

const FALLBACK_CODE = 'ERR_INTERNAL';

export const ERROR_TAXONOMY: Readonly<Record<string, TaxonomyEntry>> = Object.freeze({
  ERR_BROWSER_UNSUPPORTED: {
    code: 'ERR_BROWSER_UNSUPPORTED',
    category: 'environment',
    studentMessage:
      "This browser can't talk to robots yet. Open mBot VR in Chrome or Edge - everything else here works fine in this one.",
    suggestedAction: 'Open in Chrome or Edge',
  },
  ERR_INSECURE_CONTEXT: {
    code: 'ERR_INSECURE_CONTEXT',
    category: 'environment',
    studentMessage: "This page isn't secure enough to talk to a robot. Use the https:// link.",
    suggestedAction: 'Use the https:// address',
  },
  ERR_POLICY_BLOCKED: {
    code: 'ERR_POLICY_BLOCKED',
    category: 'environment',
    studentMessage:
      "This computer isn't allowed to connect to robots. Ask your teacher - they'll need to show this to IT.",
    suggestedAction: 'Show IT the policy request in Help',
  },
  ERR_PERMISSION_DENIED: {
    code: 'ERR_PERMISSION_DENIED',
    category: 'permission',
    studentMessage: 'No robot picked. Press "Find my robot" and choose the one with your cable in it.',
    suggestedAction: 'Press Find my robot and choose a port',
  },
  ERR_NO_PORT_SELECTED: {
    code: 'ERR_NO_PORT_SELECTED',
    category: 'permission',
    studentMessage: 'No robot was chosen. Press "Find my robot" to try again.',
    suggestedAction: 'Chooser dismissed - try again',
  },
  ERR_NO_PORTS_FOUND: {
    code: 'ERR_NO_PORTS_FOUND',
    category: 'connection',
    studentMessage: "No robots showed up. Check the cable, or try the computer's other USB socket.",
    suggestedAction: 'Check the cable; try the other USB socket',
  },
  ERR_PORT_BUSY: {
    code: 'ERR_PORT_BUSY',
    category: 'connection',
    studentMessage: 'Something else is using this robot. Close mBlock or the Arduino window and try again.',
    suggestedAction: 'Close mBlock or Arduino IDE',
  },
  ERR_PORT_OPEN_FAILED: {
    code: 'ERR_PORT_OPEN_FAILED',
    category: 'connection',
    studentMessage: "Couldn't open the connection. Unplug the cable, plug it back in, and try again.",
    suggestedAction: 'Unplug, replug, retry',
  },
  ERR_DRIVER_SUSPECTED: {
    code: 'ERR_DRIVER_SUSPECTED',
    category: 'connection',
    studentMessage: "The robot is on, but this computer can't see it. Ask a teacher - it may need a driver.",
    suggestedAction: 'Robot powered but no port - driver may be missing',
  },
  ERR_BT_NOT_PAIRED: {
    code: 'ERR_BT_NOT_PAIRED',
    category: 'connection',
    studentMessage: "Pair your robot in this computer's Bluetooth settings first, then come back.",
    suggestedAction: 'Pair in system Bluetooth settings first',
  },
  ERR_BT_MODULE_UNSUPPORTED: {
    code: 'ERR_BT_MODULE_UNSUPPORTED',
    category: 'connection',
    studentMessage: "This robot's wireless module can't be used from a browser. Use the cable instead.",
    suggestedAction: "This module can't be reached - use the cable",
  },
  ERR_NO_REPLY: {
    code: 'ERR_NO_REPLY',
    category: 'handshake',
    studentMessage:
      "Found the robot, but it isn't answering. Check it's switched on and the battery isn't flat, then press \"Find my robot\" again.",
    suggestedAction: 'Switch the robot on; check the battery',
  },
  ERR_FIRMWARE_UNKNOWN: {
    code: 'ERR_FIRMWARE_UNKNOWN',
    category: 'handshake',
    studentMessage: 'This robot has a different program on it already. Ask a teacher to restore it.',
    suggestedAction: 'Robot has a different program on it - restore firmware',
  },
  ERR_FIRMWARE_TOO_OLD: {
    code: 'ERR_FIRMWARE_TOO_OLD',
    category: 'handshake',
    studentMessage: 'Ask your teacher to update this robot before using it.',
    suggestedAction: 'Ask your teacher to update this robot',
  },
  ERR_IDENTITY_REJECTED: {
    code: 'ERR_IDENTITY_REJECTED',
    category: 'safety',
    studentMessage: 'Okay - pick a different robot with "Find my robot".',
    suggestedAction: 'Student said "not my robot" - pick another',
  },
  ERR_PREFLIGHT_BLOCKED: {
    code: 'ERR_PREFLIGHT_BLOCKED',
    category: 'program',
    studentMessage: 'One of your blocks only works in the simulator, not on a real robot.',
    suggestedAction: 'Named block cannot run on a real robot',
  },
  ERR_PROGRAM_TOO_LARGE: {
    code: 'ERR_PROGRAM_TOO_LARGE',
    category: 'program',
    studentMessage: "This program is too big to store on the robot. Run it with the cable plugged in instead.",
    suggestedAction: 'Too big to store - run it with the cable instead',
  },
  ERR_SEND_TIMEOUT: {
    code: 'ERR_SEND_TIMEOUT',
    category: 'transfer',
    studentMessage: "Sending didn't finish in time. Nothing was left running on the robot - try again.",
    suggestedAction: "Didn't finish - nothing was left on the robot",
  },
  ERR_VERIFY_FAILED: {
    code: 'ERR_VERIFY_FAILED',
    category: 'transfer',
    studentMessage: 'The program arrived damaged. Send it again.',
    suggestedAction: 'Program arrived damaged - send it again',
  },
  ERR_TRANSFER_INTERRUPTED: {
    code: 'ERR_TRANSFER_INTERRUPTED',
    category: 'transfer',
    studentMessage: 'Sending stopped partway through, so the robot was cleared for safety. Send it again.',
    suggestedAction: 'Robot cleared for safety - send again',
  },
  ERR_FLASH_SYNC_FAILED: {
    code: 'ERR_FLASH_SYNC_FAILED',
    category: 'firmware',
    studentMessage: "The robot's bootloader didn't answer. Try again, or try a different cable.",
    suggestedAction: "Bootloader didn't answer - retry, then try another cable",
  },
  ERR_FLASH_VERIFY_FAILED: {
    code: 'ERR_FLASH_VERIFY_FAILED',
    category: 'firmware',
    studentMessage: 'This robot needs to be re-flashed before it can be used.',
    suggestedAction: 'Re-flash needed before this robot is usable',
  },
  ERR_LINK_LOST: {
    code: 'ERR_LINK_LOST',
    category: 'runtime',
    studentMessage: 'Lost the robot. It may still be moving - pick it up and switch it off if it does not stop.',
    suggestedAction: 'Robot may still be moving - check it',
  },
  ERR_STOP_UNCONFIRMED: {
    code: 'ERR_STOP_UNCONFIRMED',
    category: 'safety',
    studentMessage: 'Your robot may still be moving. Pick it up and switch it off.',
    suggestedAction: 'Pick the robot up and switch it off',
  },
  ERR_RATE_LIMITED: {
    code: 'ERR_RATE_LIMITED',
    category: 'runtime',
    studentMessage: 'Give it a moment before sending again.',
    suggestedAction: 'Wait a moment before sending again',
  },
  [FALLBACK_CODE]: {
    code: FALLBACK_CODE,
    category: 'fallback',
    studentMessage: 'Something unexpected happened. Copy the troubleshooting report and show a teacher.',
    suggestedAction: 'Copy the troubleshooting report and show a teacher',
  },
});

/** Every code, for completeness tests and for iterating the taxonomy in the UI. */
export const ERROR_CODES = Object.keys(ERROR_TAXONOMY);

function hasStringCode(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string';
}

/**
 * Maps any thrown value to a taxonomy entry. Anything with a known `code` property
 * (a `DeviceError`, in practice) resolves directly; everything else - a plain `Error`,
 * a rejected promise's reason, a string - becomes `ERR_INTERNAL`, on the theory that an
 * unmapped failure is a bug to fix by adding a code, not a message to improve.
 */
export function classifyError(error: unknown): TaxonomyEntry {
  if (hasStringCode(error) && error.code in ERROR_TAXONOMY) {
    return ERROR_TAXONOMY[error.code];
  }
  return ERROR_TAXONOMY[FALLBACK_CODE];
}

/** The raw message to log alongside a classified error, before redaction. */
export function rawMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
