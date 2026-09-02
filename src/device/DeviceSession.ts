import type { SerialLink } from './SerialTransport';
import {
  DeviceId,
  FrameParser,
  decodeString,
  encodeGet,
  encodeMotorRun,
  encodeReset,
  encodeRgbLed,
  encodeRun,
  nextIndex,
} from './MakeblockProtocol';
import { DeviceError, UNKNOWN_DEVICE_PROFILE, type ConnectionStatus, type DeviceProfile, type LinkKind } from './types';

/**
 * The kit's conventional default wiring for the two sensors this app's blocks need,
 * used when a robot's actual ports have not been confirmed (see
 * `docs/hardware-bridge-plan.md` U3/U7). A teacher can override these once a device
 * profile UI exists; until then this is the app's one assumption about port wiring.
 */
const DEFAULT_ULTRASONIC_PORT = 3;
const DEFAULT_LINE_FOLLOWER_PORT = 2;

const IDENTIFY_TIMEOUT_MS = 2000;
const IDENTIFY_ATTEMPTS = 3;
const IDENTIFY_RETRY_GAP_MS = 400;
const READ_TIMEOUT_MS = 400;
const READ_RETRIES = 2;

export interface DeviceSessionCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void;
  /** A lightweight log sink - `DiagnosticLog.log`'s shape, without importing it directly. */
  onLog?: (event: { message: string; detail?: string; code?: string; elapsedMs?: number; retryCount?: number }) => void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HEX_PREVIEW_MAX_BYTES = 32;

/** A short, log-friendly hex dump - protocol bytes, never anything student-identifying. */
function hexPreview(bytes: Uint8Array): string {
  const shown = bytes.length > HEX_PREVIEW_MAX_BYTES ? bytes.subarray(0, HEX_PREVIEW_MAX_BYTES) : bytes;
  const hex = Array.from(shown, (b) => b.toString(16).padStart(2, '0')).join(' ');
  const suffix = bytes.length > HEX_PREVIEW_MAX_BYTES ? ` … (+${bytes.length - HEX_PREVIEW_MAX_BYTES} more bytes)` : '';
  return `[${bytes.length}B] ${hex}${suffix}`;
}

/**
 * Owns one open serial link to a robot and everything session-scoped about it: the
 * connect/identify state machine, request/reply correlation, and the actuator/sensor
 * primitives `SerialRobotRuntime` and `StopController` are built from.
 *
 * Takes an already-open `SerialLink` rather than requesting a port itself - port
 * permission and opening are Web-Serial-specific browser calls (see
 * `SerialTransport.ts`), and keeping them out of this class is what lets it be
 * constructed with a fake link in tests with no browser involved at all.
 */
export class DeviceSession {
  private parser = new FrameParser();
  private index = 0;
  private pending = new Map<number, { resolve: (payload: Uint8Array) => void; reject: (err: unknown) => void }>();
  private status: ConnectionStatus;
  private profile: DeviceProfile = UNKNOWN_DEVICE_PROFILE;
  private identityConfirmed = false;
  private unsubData: () => void;
  private unsubDisconnect: () => void;
  private disposed = false;

  constructor(
    private readonly link: SerialLink,
    private readonly linkKind: LinkKind,
    private readonly callbacks: DeviceSessionCallbacks = {},
  ) {
    this.status = { phase: 'opening', link: linkKind };
    this.unsubData = link.onData((bytes) => this.handleData(bytes));
    this.unsubDisconnect = link.onDisconnect(() => this.handleDisconnect());
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getProfile(): DeviceProfile {
    return this.profile;
  }

  /** True once the student has confirmed "yes, that's my robot" this session. */
  isIdentityConfirmed(): boolean {
    return this.identityConfirmed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubData();
    this.unsubDisconnect();
    this.rejectAllPending(new DeviceError('ERR_LINK_LOST', 'Session disposed.'));
    void this.link.close();
  }

  // --- connect / identify -----------------------------------------------------------

  /**
   * Probes for a live, protocol-speaking board via a `VERSION` GET - the one request
   * that needs no port and that the firmware answers regardless of what's physically
   * wired up (see the confidence note in `MakeblockProtocol.ts`). Up to
   * `IDENTIFY_ATTEMPTS`, each waiting `IDENTIFY_TIMEOUT_MS` for a reply,
   * `IDENTIFY_RETRY_GAP_MS` apart - see `docs/hardware-bridge-plan.md` §8. On success
   * the session holds a fresh `DeviceProfile` (the firmware's own reported version,
   * plus the kit's default port wiring; see the constants above) and moves to
   * `confirmingIdentity`, where the caller is expected to `wink()` and then call
   * `confirmIdentity()` once a student has agreed this is their robot.
   */
  async identify(): Promise<void> {
    const start = performance.now();
    for (let attempt = 1; attempt <= IDENTIFY_ATTEMPTS; attempt += 1) {
      this.setStatus({ phase: 'identifying', link: this.linkKind, attempt });
      try {
        const payload = await this.requestVersion(IDENTIFY_TIMEOUT_MS);
        const version = decodeString(payload) || null;
        this.profile = {
          ...UNKNOWN_DEVICE_PROFILE,
          firmwareVersion: version,
          ultrasonicPort: DEFAULT_ULTRASONIC_PORT,
          lineFollowerPort: DEFAULT_LINE_FOLLOWER_PORT,
        };
        this.callbacks.onLog?.({
          message: version ? `Robot answered - firmware ${version}` : 'Robot answered - confirming identity',
          elapsedMs: Math.round(performance.now() - start),
          retryCount: attempt - 1,
        });
        this.setStatus({ phase: 'confirmingIdentity', link: this.linkKind, profile: this.profile });
        return;
      } catch {
        // fall through and retry, or give up below once attempts are exhausted
      }
      if (attempt < IDENTIFY_ATTEMPTS) await wait(IDENTIFY_RETRY_GAP_MS);
    }
    const error = new DeviceError('ERR_NO_REPLY', 'No reply after 3 attempts.');
    this.callbacks.onLog?.({
      message: 'Robot did not answer',
      code: error.code,
      elapsedMs: Math.round(performance.now() - start),
      retryCount: IDENTIFY_ATTEMPTS,
    });
    this.setStatus({ phase: 'error', code: error.code, link: this.linkKind });
    throw error;
  }

  /**
   * Flashes the onboard LEDs so a student can match the robot in front of them to the
   * one the app just connected to. Best-effort: a failure here does not fail the
   * connection, since the identify probe already proved the link works.
   */
  async wink(): Promise<void> {
    const sequence: Array<[number, number, number]> = [
      [0, 120, 255],
      [0, 0, 0],
      [0, 120, 255],
      [0, 0, 0],
    ];
    try {
      for (const [r, g, b] of sequence) {
        await this.sendRgbLed(r, g, b);
        await wait(150);
      }
    } catch {
      // A wink is a nicety, not a safety-relevant confirmation - the "yes, that's
      // mine" click is what actually gates sending anything to the robot.
    }
  }

  /** Records the student's "yes, that's mine" and moves to `ready`. */
  confirmIdentity(): void {
    if (this.status.phase !== 'confirmingIdentity') return;
    this.identityConfirmed = true;
    this.setStatus({ phase: 'ready', link: this.linkKind, profile: this.profile });
  }

  /** Records the student's "no, try a different one". Closes this session's link. */
  rejectIdentity(): void {
    this.identityConfirmed = false;
    this.setStatus({ phase: 'disconnected' });
    this.dispose();
  }

  // --- run lifecycle (used by App.tsx around ProgramRunner) --------------------------

  beginRun(): void {
    if (this.status.phase !== 'ready') return;
    this.setStatus({ phase: 'running', link: this.linkKind, profile: this.profile });
  }

  /** Returns to `ready` without going through the stop escalation ladder - see `StopController`. */
  endRunIdle(): void {
    if (!this.identityConfirmed) return;
    this.setStatus({ phase: 'ready', link: this.linkKind, profile: this.profile });
  }

  markStopping(): void {
    if (!this.identityConfirmed) return;
    this.setStatus({ phase: 'stopping', link: this.linkKind, profile: this.profile });
  }

  markStopOutcome(confirmed: boolean): void {
    if (!this.identityConfirmed) return;
    this.setStatus(
      confirmed
        ? { phase: 'ready', link: this.linkKind, profile: this.profile }
        : { phase: 'stopUnconfirmed', link: this.linkKind, profile: this.profile },
    );
  }

  /**
   * The student's "I checked it" after a `stopUnconfirmed` warning - the one other way
   * (besides a later successful probe) that banner is allowed to clear. Only valid from
   * `stopUnconfirmed`, so it cannot be used to skip the warning some other way.
   */
  acknowledgeStopUnconfirmed(): void {
    if (this.status.phase !== 'stopUnconfirmed') return;
    this.setStatus({ phase: 'ready', link: this.linkKind, profile: this.profile });
  }

  // --- actuators (fire-and-forget writes - never retried; see plan §8) ---------------

  async setMotor(port: number, speed: number): Promise<void> {
    await this.write(encodeMotorRun(this.nextIdx(), port, speed));
  }

  async setRgbLed(slot: number, r: number, g: number, b: number): Promise<void> {
    await this.write(encodeRgbLed(this.nextIdx(), slot, r, g, b));
  }

  /** Convenience: the wink sequence's "both LEDs" case. */
  private async sendRgbLed(r: number, g: number, b: number): Promise<void> {
    await this.setRgbLed(2, r, g, b);
  }

  /** RESET action - stops both motors and the buzzer on the firmware side. */
  async hardReset(): Promise<void> {
    await this.write(encodeReset(this.nextIdx()));
  }

  /** One RUN frame to an arbitrary device - used sparingly, for things without a dedicated helper. */
  async run(deviceId: number, params: number[]): Promise<void> {
    await this.write(encodeRun(this.nextIdx(), deviceId, params));
  }

  // --- sensors (reads - retried up to READ_RETRIES times) ----------------------------

  async getUltrasonicPayload(): Promise<Uint8Array> {
    const port = this.profile.ultrasonicPort ?? DEFAULT_ULTRASONIC_PORT;
    return this.requestWithRetries(DeviceId.ULTRASONIC, [port]);
  }

  async getLineFollowerPayload(): Promise<Uint8Array> {
    const port = this.profile.lineFollowerPort ?? DEFAULT_LINE_FOLLOWER_PORT;
    return this.requestWithRetries(DeviceId.LINE_FOLLOWER, [port]);
  }

  // --- stop escalation primitives (see StopController.ts) ----------------------------

  /** A cheap, side-effect-free GET used as a liveness check. Never throws; returns false on timeout. */
  async probe(timeoutMs: number): Promise<boolean> {
    try {
      await this.requestVersion(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  private async requestVersion(timeoutMs: number): Promise<Uint8Array> {
    return this.requestOnce(DeviceId.VERSION, [], timeoutMs);
  }

  /** Toggles DTR to pulse the bootloader's auto-reset line. See plan §9, step 4. */
  async pulseReset(): Promise<void> {
    await this.link.setSignals({ dataTerminalReady: true });
    await wait(50);
    await this.link.setSignals({ dataTerminalReady: false });
  }

  // --- internals -----------------------------------------------------------------

  private nextIdx(): number {
    this.index = nextIndex(this.index);
    return this.index;
  }

  private async write(frame: Uint8Array): Promise<void> {
    try {
      await this.link.write(frame);
    } catch (error) {
      throw error instanceof DeviceError ? error : new DeviceError('ERR_LINK_LOST', 'Write failed.', error);
    }
  }

  private async requestOnce(deviceId: number, params: number[], timeoutMs: number): Promise<Uint8Array> {
    const idx = this.nextIdx();
    const frame = encodeGet(idx, deviceId, params);
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(idx);
        reject(new DeviceError('ERR_NO_REPLY', 'No reply within timeout.'));
      }, timeoutMs);
      this.pending.set(idx, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.link.write(frame).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(idx);
        reject(err instanceof DeviceError ? err : new DeviceError('ERR_LINK_LOST', 'Write failed.', err));
      });
    });
  }

  private async requestWithRetries(deviceId: number, params: number[]): Promise<Uint8Array> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= READ_RETRIES; attempt += 1) {
      try {
        return await this.requestOnce(deviceId, params, READ_TIMEOUT_MS);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof DeviceError ? lastError : new DeviceError('ERR_NO_REPLY', 'No reply after retries.');
  }

  private handleData(bytes: Uint8Array): void {
    // While still connecting, log a hex preview of every chunk that arrives - even one
    // that fails to parse into a frame. This is the single most useful piece of
    // evidence for diagnosing a connection failure remotely: it distinguishes "the
    // robot never sent anything" (still resetting, wrong port, no factory firmware)
    // from "it replied and this app misparsed it" (a real parser bug) without needing
    // physical access to the hardware. Not logged once identity is confirmed, so
    // ordinary operation does not spam the log with per-command chatter.
    if (!this.identityConfirmed) {
      this.callbacks.onLog?.({ message: 'Raw bytes received', detail: hexPreview(bytes) });
    }
    const frames = this.parser.push(bytes);
    for (const frame of frames) {
      // A bare RUN/RESET/START acknowledgement carries no index at all (see the
      // confidence note in MakeblockProtocol.ts) - there is nothing to correlate it
      // to, so it is intentionally dropped here rather than escalated as an error.
      if (frame.index === null) continue;
      const waiter = this.pending.get(frame.index);
      if (!waiter) continue; // stray or late reply - not escalated as an error
      this.pending.delete(frame.index);
      waiter.resolve(frame.payload);
    }
  }

  private handleDisconnect(): void {
    if (this.disposed) return;
    this.rejectAllPending(new DeviceError('ERR_LINK_LOST', 'Serial link disconnected.'));
    this.identityConfirmed = false;
    this.callbacks.onLog?.({ message: 'Connection lost', code: 'ERR_LINK_LOST' });
    this.setStatus({ phase: 'linkLost', link: this.linkKind });
  }

  private rejectAllPending(error: unknown): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }
}
