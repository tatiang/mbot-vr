import { describe, expect, it } from 'vitest';
import { DISPLAY_BLANK, DISPLAY_ERROR, formatDisplay } from '../src/simulation/SevenSegment';

/**
 * Behaviour mirrors `Scripts/Seven segment display.lua` in the original project:
 * four digit positions, dashes on overflow, minus takes a position.
 */
describe('seven segment display formatting', () => {
  it('shows whole numbers', () => {
    expect(formatDisplay(0)).toBe('0');
    expect(formatDisplay(42)).toBe('42');
    expect(formatDisplay(9999)).toBe('9999');
    expect(formatDisplay(-999)).toBe('-999');
  });

  it('shows dashes when the value will not fit', () => {
    expect(formatDisplay(10000)).toBe(DISPLAY_ERROR);
    expect(formatDisplay(-1000)).toBe(DISPLAY_ERROR);
    expect(formatDisplay(Number.NaN)).toBe(DISPLAY_ERROR);
    expect(formatDisplay(Infinity)).toBe(DISPLAY_ERROR);
  });

  it('fits decimals into the remaining digit positions', () => {
    expect(formatDisplay(17.4)).toBe('17.4');
    expect(formatDisplay(3.14159)).toBe('3.142');
    expect(formatDisplay(123.456)).toBe('123.5');
  });

  it('drops trailing zeros like the original script', () => {
    expect(formatDisplay(2.5)).toBe('2.5');
    expect(formatDisplay(2.0)).toBe('2');
  });

  it('leaves room for the minus sign', () => {
    expect(formatDisplay(-1.25)).toBe('-1.25');
    expect(formatDisplay(-12.5)).toBe('-12.5');
  });

  it('blanks on an empty string and passes short words through', () => {
    expect(formatDisplay('')).toBe(DISPLAY_BLANK);
    expect(formatDisplay('hi')).toBe('HI');
    expect(formatDisplay('12.5')).toBe('12.5');
  });
});
