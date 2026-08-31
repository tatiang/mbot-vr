/**
 * Formatting rules for the mBot's 4-digit seven-segment display.
 *
 * Mirrors `Scripts/Seven segment display.lua` from the original project:
 * four digit positions, an optional decimal point, a leading minus that
 * occupies one of the four positions, and four dashes when the value cannot
 * be represented.
 */

export const DISPLAY_BLANK = '    ';
export const DISPLAY_ERROR = '----';

/**
 * Renders a value the way the physical display would.
 * Returns at most 4 digit characters (the '.' rides along with its digit).
 */
export function formatDisplay(value: number | string): string {
  if (typeof value === 'string') {
    // Strings are not something the hardware supports; show the first four
    // characters so `display "HI"` still does something friendly.
    const trimmed = value.trim();
    if (trimmed === '') return DISPLAY_BLANK;
    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber)) return formatDisplay(asNumber);
    return trimmed.slice(0, 4).toUpperCase();
  }

  if (!Number.isFinite(value)) return DISPLAY_ERROR;

  // The hardware shows whole numbers up to 9999 and down to -999 (the minus
  // sign eats a digit position).
  if (value > 9999 || value < -999) return DISPLAY_ERROR;

  const negative = value < 0;
  const magnitude = Math.abs(value);
  const digitBudget = negative ? 3 : 4;

  if (Number.isInteger(magnitude)) {
    return (negative ? '-' : '') + String(magnitude);
  }

  // Fit as many decimals as the remaining digit positions allow.
  const wholeDigits = Math.max(1, String(Math.floor(magnitude)).length);
  const decimals = Math.max(0, digitBudget - wholeDigits);
  if (decimals === 0) {
    const rounded = Math.round(magnitude);
    if (rounded > (negative ? 999 : 9999)) return DISPLAY_ERROR;
    return (negative ? '-' : '') + String(rounded);
  }

  const rounded = magnitude.toFixed(decimals);
  // Rounding can carry into an extra digit (9.99 at 2 dp -> 10.0).
  if (String(Math.floor(Number(rounded))).length > wholeDigits) {
    return formatDisplay(negative ? -Number(rounded) : Number(rounded));
  }
  // Trailing zeros are dropped, matching the Lua `%.?0+$` gsub.
  const trimmed = rounded.replace(/\.?0+$/, '');
  return (negative ? '-' : '') + (trimmed === '' ? '0' : trimmed);
}
