import { redact } from './redact';
import { classifyError, rawMessageOf, type ErrorCategory } from './taxonomy';

/**
 * One entry in the diagnostic log. See `docs/hardware-bridge-plan.md` §11 for the full
 * rationale; this is a flattened version of that event shape, kept to the fields this
 * app actually populates rather than every field the report enumerates in the abstract.
 */
export interface DiagnosticEvent {
  id: number;
  /** `performance.now()` at the time of the event - monotonic, orderable, not wall-clock. */
  t: number;
  isoTime: string;
  /** Short human label for what happened, already redacted. */
  message: string;
  /** A normalized taxonomy code, when this event is an error. */
  code?: string;
  category?: ErrorCategory;
  /** Extra technical context (a state name, a byte count, a raw exception message), redacted. */
  detail?: string;
  suggestedAction?: string;
  elapsedMs?: number;
  retryCount?: number;
}

const MAX_EVENTS = 500;
const MAX_BYTES = 256 * 1024;
const SESSION_KEY = 'mbotvr.diagnostics.v1';

/**
 * A bounded, session-scoped log of device-layer events.
 *
 * `sessionStorage`, not `localStorage`: the log is most useful right after a student
 * refreshes the page trying to unstick a connection, but it has no business surviving
 * past the tab - a shared classroom Chromebook's next student should not inherit it.
 * Both the size cap and the storage choice are deliberate bounds, not oversights.
 */
export class DiagnosticLog {
  private events: DiagnosticEvent[] = [];
  private droppedCount = 0;
  private nextId = 1;
  private listeners = new Set<() => void>();
  private persistHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly appVersion: string) {
    this.events = DiagnosticLog.readSession();
    if (this.events.length) {
      this.nextId = Math.max(...this.events.map((e) => e.id)) + 1;
    }
  }

  getEvents(): readonly DiagnosticEvent[] {
    return this.events;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Records one event. `message` and `detail` are redacted before anything else happens to them. */
  log(input: {
    message: string;
    code?: string;
    category?: ErrorCategory;
    detail?: string;
    suggestedAction?: string;
    elapsedMs?: number;
    retryCount?: number;
  }): void {
    const event: DiagnosticEvent = {
      id: this.nextId++,
      t: performance.now(),
      isoTime: new Date().toISOString(),
      message: redact(input.message),
      code: input.code,
      category: input.category,
      detail: input.detail === undefined ? undefined : redact(input.detail),
      suggestedAction: input.suggestedAction,
      elapsedMs: input.elapsedMs,
      retryCount: input.retryCount,
    };
    this.push(event);
  }

  /** Convenience for the common case: log a caught error, already classified and redacted. */
  logError(message: string, error: unknown, extra: { elapsedMs?: number; retryCount?: number } = {}): void {
    const entry = classifyError(error);
    this.log({
      message,
      code: entry.code,
      category: entry.category,
      detail: rawMessageOf(error),
      suggestedAction: entry.suggestedAction,
      ...extra,
    });
  }

  clear(): void {
    this.events = [];
    this.droppedCount = 0;
    this.persist();
    this.notify();
  }

  private push(event: DiagnosticEvent): void {
    this.events.push(event);
    this.trim();
    this.schedulePersist();
    this.notify();
  }

  private trim(): void {
    while (this.events.length > MAX_EVENTS) {
      this.events.shift();
      this.droppedCount += 1;
    }
    while (this.events.length > 1 && approximateByteSize(this.events) > MAX_BYTES) {
      this.events.shift();
      this.droppedCount += 1;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    if (this.persistHandle) return;
    // Debounced the same way autosave is in App.tsx - a burst of events (a fast retry
    // loop) should not mean a synchronous storage write per event.
    this.persistHandle = setTimeout(() => {
      this.persistHandle = null;
      this.persist();
    }, 300);
  }

  private persist(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ appVersion: this.appVersion, events: this.events }));
    } catch {
      // Out of quota or storage disabled - the log still works in memory for this tab.
    }
  }

  private static readSession(): DiagnosticEvent[] {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { events?: unknown };
      return Array.isArray(parsed.events) ? (parsed.events as DiagnosticEvent[]) : [];
    } catch {
      return [];
    }
  }
}

function approximateByteSize(events: DiagnosticEvent[]): number {
  // Good enough for a soft cap: exact UTF-8 byte counting is not worth the cost here.
  return JSON.stringify(events).length;
}
