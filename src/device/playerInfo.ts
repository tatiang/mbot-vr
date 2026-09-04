/**
 * Parses the `INFO` reply Player firmware sends back (see `docs/player-protocol.md`
 * §2.1): an ASCII string of the form
 *
 *   MBVR player=1 idle=<0|1> prog=<0|1> plen=<n> crc=<n>
 *
 * Kept separate from `DeviceSession.ts` so the format can be unit-tested with plain
 * strings, no serial link or hardware involved.
 */

export interface PlayerInfo {
  /** True when the boot-idle halt flag is set - a stored program will not run at boot. */
  idle: boolean;
  /** True when a valid program is stored (magic present, checksum matches). */
  hasProgram: boolean;
  /** Length of the stored instruction stream in bytes; 0 when `hasProgram` is false. */
  programBytes: number;
  /** The stored program's checksum16, for cross-checking against a fresh compile. */
  checksum: number;
}

export function parsePlayerInfo(raw: string): PlayerInfo | null {
  const tokens = raw.trim().split(/\s+/);
  if (tokens[0] !== 'MBVR') return null;

  const fields = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    fields.set(token.slice(0, eq), token.slice(eq + 1));
  }

  const idle = fields.get('idle');
  const prog = fields.get('prog');
  const plen = fields.get('plen');
  const crc = fields.get('crc');
  if (idle === undefined || prog === undefined || plen === undefined || crc === undefined) return null;

  return {
    idle: idle === '1',
    hasProgram: prog === '1',
    programBytes: Number(plen) || 0,
    checksum: Number(crc) || 0,
  };
}

/** A classroom-language summary of what's actually stored on the robot right now. */
export function describePlayerInfo(info: PlayerInfo): string {
  if (!info.hasProgram) return "No code is stored on this robot yet.";
  if (info.idle) {
    return `There's code stored (${info.programBytes} bytes), but it won't run at startup - clear it or upload new code to change that.`;
  }
  return `There's code stored (${info.programBytes} bytes) and it'll run the next time the robot powers on.`;
}
