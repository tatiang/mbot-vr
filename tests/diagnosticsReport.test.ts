import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '../src/diagnostics/DiagnosticLog';
import {
  describeEnvironment,
  formatEventsAsJson,
  formatEventsAsText,
  formatTroubleshootingReport,
} from '../src/diagnostics/report';

function event(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
  return {
    id: 1,
    t: 0,
    isoTime: '2026-09-02T12:00:00.000Z',
    message: 'connecting',
    ...overrides,
  };
}

describe('describeEnvironment', () => {
  it('falls back to Unknown when there is no navigator', () => {
    const info = describeEnvironment();
    expect(info.browser).toBeTruthy();
    expect(info.os).toBeTruthy();
  });
});

describe('formatEventsAsText', () => {
  it('includes the app version, event count, and each event', () => {
    const text = formatEventsAsText([event({ message: 'robot answered' })], '1.2.0');
    expect(text).toContain('1.2.0');
    expect(text).toContain('1 event');
    expect(text).toContain('robot answered');
  });

  it('includes the code, elapsed time and detail when present', () => {
    const text = formatEventsAsText(
      [event({ message: 'stop', code: 'ERR_STOP_UNCONFIRMED', elapsedMs: 640, detail: 'halt, no reply' })],
      '1.2.0',
    );
    expect(text).toContain('ERR_STOP_UNCONFIRMED');
    expect(text).toContain('+640ms');
    expect(text).toContain('halt, no reply');
  });
});

describe('formatEventsAsJson', () => {
  it('produces parseable JSON carrying the app version and events', () => {
    const json = formatEventsAsJson([event()], '1.2.0');
    const parsed = JSON.parse(json);
    expect(parsed.appVersion).toBe('1.2.0');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.environment).toBeTruthy();
  });
});

describe('formatTroubleshootingReport', () => {
  it('reports no error when none was logged', () => {
    const report = formatTroubleshootingReport([event({ message: 'connected' })], '1.2.0');
    expect(report).toContain('No error recorded this session.');
  });

  it('surfaces the most recent error code and suggested action', () => {
    const events = [
      event({ id: 1, message: 'connecting' }),
      event({ id: 2, message: 'failed', code: 'ERR_NO_REPLY', suggestedAction: 'Switch the robot on' }),
    ];
    const report = formatTroubleshootingReport(events, '1.2.0');
    expect(report).toContain('ERR_NO_REPLY');
    expect(report).toContain('Switch the robot on');
  });

  it('only includes the last 5 events', () => {
    const events = Array.from({ length: 8 }, (_, i) => event({ id: i, message: `event ${i}` }));
    const report = formatTroubleshootingReport(events, '1.2.0');
    expect(report).not.toContain('event 0');
    expect(report).toContain('event 7');
  });
});
