import type { DiagnosticEvent } from './DiagnosticLog';

/** Coarse browser/OS identification for the log header - family and major version only. */
export interface EnvironmentInfo {
  browser: string;
  os: string;
}

/**
 * Best-effort `navigator.userAgent` parsing. Deliberately coarse: this exists so a
 * teacher can tell "Chrome on a Chromebook" from "Safari on a Mac" at a glance, not to
 * fingerprint a device. No version number below the major is kept.
 */
export function describeEnvironment(): EnvironmentInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  let os = 'Unknown OS';
  if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Unknown browser';
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = /Safari\//.test(ua) && !chromeMatch ? ua.match(/Version\/(\d+)/) : null;
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;

  return { browser, os };
}

function formatOne(event: DiagnosticEvent): string {
  const time = event.isoTime.slice(11, 23); // HH:MM:SS.mmm, local report only needs this
  const parts = [`[${time}]`, event.message];
  if (event.code) parts.push(`(${event.code})`);
  if (event.elapsedMs !== undefined) parts.push(`+${event.elapsedMs}ms`);
  if (event.retryCount) parts.push(`retry ${event.retryCount}`);
  const line = parts.join(' ');
  return event.detail ? `${line}\n    ${event.detail}` : line;
}

/** Readable plain text, newest event last - the natural reading order for a log. */
export function formatEventsAsText(events: readonly DiagnosticEvent[], appVersion: string): string {
  const env = describeEnvironment();
  const header = [
    'mBot VR diagnostic log',
    `App ${appVersion} · ${env.browser} · ${env.os}`,
    `${events.length} event${events.length === 1 ? '' : 's'}`,
    '',
  ].join('\n');
  return header + events.map(formatOne).join('\n');
}

/** Structured JSON for attaching to an issue report. */
export function formatEventsAsJson(events: readonly DiagnosticEvent[], appVersion: string): string {
  const env = describeEnvironment();
  return JSON.stringify({ appVersion, environment: env, events }, null, 2);
}

/**
 * The "Copy troubleshooting report" summary: a dozen lines a student can paste into an
 * email or a help-desk ticket without scrolling through the full log.
 */
export function formatTroubleshootingReport(events: readonly DiagnosticEvent[], appVersion: string): string {
  const env = describeEnvironment();
  const recent = events.slice(-5);
  const lastError = [...events].reverse().find((e) => e.code);

  const lines = [
    'mBot VR troubleshooting report',
    `App: ${appVersion}`,
    `Browser: ${env.browser}`,
    `OS: ${env.os}`,
    '',
    'Last 5 events:',
    ...(recent.length ? recent.map((e) => `  ${formatOne(e).split('\n')[0]}`) : ['  (none)']),
    '',
  ];
  if (lastError) {
    lines.push(`Last error code: ${lastError.code}`, `Suggested action: ${lastError.suggestedAction ?? '(none)'}`);
  } else {
    lines.push('No error recorded this session.');
  }
  return lines.join('\n');
}
