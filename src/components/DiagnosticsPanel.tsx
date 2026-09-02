import { useEffect, useState } from 'react';
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog';
import { formatEventsAsJson, formatEventsAsText, formatTroubleshootingReport } from '../diagnostics/report';
import { DownloadIcon, TrashIcon } from './icons';

interface Props {
  log: DiagnosticLog;
  appVersion: string;
  onMessage?: (kind: 'success' | 'error' | 'info', text: string) => void;
}

function download(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The log viewer from `docs/hardware-bridge-plan.md` §11: view, copy, download, clear,
 * plus the "Copy troubleshooting report" summary a student can actually paste
 * somewhere. Subscribes to the log directly rather than lifting its state into
 * `App.tsx`, since nothing else in the app needs to react to it.
 */
export function DiagnosticsPanel({ log, appVersion, onMessage }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => log.subscribe(() => setTick((t) => t + 1)), [log]);

  const events = log.getEvents();
  const dropped = log.getDroppedCount();

  const notify = (text: string) => onMessage?.('success', text);

  return (
    <div className="diagnostics">
      <p className="hint-text" style={{ textAlign: 'left', padding: '0 0 10px' }}>
        This log records connection steps and errors so a teacher can help troubleshoot.
        It never contains your project name, block contents, or anything typed into the
        app - see <code>src/diagnostics/redact.ts</code> for exactly what is removed.
      </p>

      <div className="diagnostics__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => {
            const ok = await copyText(formatTroubleshootingReport(events, appVersion));
            if (ok) notify('Copied troubleshooting report.');
          }}
        >
          Copy troubleshooting report
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => {
            const ok = await copyText(formatEventsAsText(events, appVersion));
            if (ok) notify('Copied the full log.');
          }}
        >
          Copy full log
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => download('mbot-vr-log.txt', formatEventsAsText(events, appVersion), 'text/plain')}
        >
          <DownloadIcon size={14} /> .txt
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => download('mbot-vr-log.json', formatEventsAsJson(events, appVersion), 'application/json')}
        >
          <DownloadIcon size={14} /> .json
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => log.clear()}>
          <TrashIcon size={14} /> Clear log
        </button>
      </div>

      {dropped > 0 && (
        <p className="hint-text" style={{ textAlign: 'left' }}>
          {dropped} earlier event{dropped === 1 ? '' : 's'} dropped to keep the log from growing without bound.
        </p>
      )}

      {events.length === 0 ? (
        <p className="hint-text" style={{ padding: '14px 0' }}>No events yet this session.</p>
      ) : (
        <ul className="diagnostics__list">
          {[...events].reverse().map((event) => (
            <li key={event.id} className="diagnostics__event">
              <span className="diagnostics__time">{event.isoTime.slice(11, 19)}</span>
              <span className="diagnostics__message">{event.message}</span>
              {event.code && <span className="diagnostics__code">{event.code}</span>}
              {event.detail && <span className="diagnostics__detail">{event.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
