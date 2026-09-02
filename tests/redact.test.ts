import { describe, expect, it } from 'vitest';
import { redact } from '../src/diagnostics/redact';

describe('redact', () => {
  it('replaces a macOS home directory with a generic placeholder', () => {
    const out = redact('opening /Users/tatiang/Documents/project.mbotvr.json');
    expect(out).not.toContain('tatiang');
    expect(out).toContain('/Users/<user>');
  });

  it('replaces a Linux home directory', () => {
    const out = redact('reading /home/student42/robot.hex');
    expect(out).not.toContain('student42');
    expect(out).toContain('/home/<user>');
  });

  it('replaces a Windows home directory', () => {
    const out = redact('at C:\\Users\\student42\\AppData\\file.txt');
    expect(out).not.toContain('student42');
    expect(out).toContain('Users\\<user>');
  });

  it('replaces a macOS serial device path entirely', () => {
    const out = redact('could not open /dev/tty.usbserial-14201');
    expect(out).not.toContain('usbserial');
    expect(out).toContain('<serial-port>');
  });

  it('replaces a Windows COM port', () => {
    const out = redact('could not open COM7');
    expect(out).toBe('could not open <serial-port>');
  });

  it('replaces a MAC-style Bluetooth address', () => {
    const out = redact('paired with A4:C1:38:9F:2B:11');
    expect(out).not.toContain('A4:C1');
    expect(out).toContain('<device-address>');
  });

  it('replaces a UUID', () => {
    const out = redact('service 6ba7b810-9dad-11d1-80b4-00c04fd430c8 granted');
    expect(out).toContain('<uuid>');
    expect(out).not.toContain('6ba7b810');
  });

  it('replaces a long hex token', () => {
    const out = redact('token=deadbeef0123456789abcdef01234567');
    expect(out).toContain('<redacted>');
  });

  it('replaces a high-entropy alphanumeric token', () => {
    const out = redact('key=aZ9k3mQ7pL2xN8vR4tY6wB1cF5hJ0sD');
    expect(out).toContain('<redacted>');
  });

  it('reduces a non-home absolute path to its basename', () => {
    const out = redact('failed to load /Applications/mBlock5.app/Contents/Resources/settings.json');
    expect(out).toContain('<path>/settings.json');
    expect(out).not.toContain('Resources');
  });

  it('does not re-reduce a path already redacted by an earlier rule', () => {
    const out = redact('opening /Users/tatiang/Documents/Class 4B/project.mbotvr.json');
    expect(out).toContain('/Users/<user>/Documents/Class 4B/project.mbotvr.json');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'The robot did not answer within 2000ms after 3 attempts.';
    expect(redact(text)).toBe(text);
  });

  it('is idempotent', () => {
    const once = redact('opening /Users/tatiang/robot.hex');
    expect(redact(once)).toBe(once);
  });
});
