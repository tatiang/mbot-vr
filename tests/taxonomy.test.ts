import { describe, expect, it } from 'vitest';
import { DeviceError } from '../src/device/types';
import { ERROR_CODES, ERROR_TAXONOMY, classifyError, rawMessageOf } from '../src/diagnostics/taxonomy';

describe('ERROR_TAXONOMY', () => {
  it('gives every code a non-empty student message and suggested action', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_TAXONOMY[code];
      expect(entry.code).toBe(code);
      expect(entry.studentMessage.length).toBeGreaterThan(0);
      expect(entry.suggestedAction.length).toBeGreaterThan(0);
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  it('never writes a student message that is just the shouting-case code, or a stack frame', () => {
    for (const code of ERROR_CODES) {
      const { studentMessage } = ERROR_TAXONOMY[code];
      expect(studentMessage).not.toMatch(/^[A-Z_]+$/);
      expect(studentMessage).not.toMatch(/\bat \S+\(.*:\d+:\d+\)/);
    }
  });

  it('includes the fallback code', () => {
    expect(ERROR_CODES).toContain('ERR_INTERNAL');
  });
});

describe('classifyError', () => {
  it('maps a DeviceError to its matching entry', () => {
    const error = new DeviceError('ERR_NO_REPLY', 'timed out');
    expect(classifyError(error).code).toBe('ERR_NO_REPLY');
  });

  it('falls back to ERR_INTERNAL for an unknown code', () => {
    const error = new DeviceError('ERR_SOMETHING_MADE_UP', 'oops');
    expect(classifyError(error).code).toBe('ERR_INTERNAL');
  });

  it('falls back to ERR_INTERNAL for a plain Error', () => {
    expect(classifyError(new Error('boom')).code).toBe('ERR_INTERNAL');
  });

  it('falls back to ERR_INTERNAL for a thrown string', () => {
    expect(classifyError('boom').code).toBe('ERR_INTERNAL');
  });

  it('falls back to ERR_INTERNAL for null', () => {
    expect(classifyError(null).code).toBe('ERR_INTERNAL');
  });
});

describe('rawMessageOf', () => {
  it('reads the message off an Error', () => {
    expect(rawMessageOf(new Error('boom'))).toBe('boom');
  });

  it('passes a string through', () => {
    expect(rawMessageOf('boom')).toBe('boom');
  });

  it('stringifies anything else', () => {
    expect(rawMessageOf({ x: 1 })).toBe('{"x":1}');
  });
});
