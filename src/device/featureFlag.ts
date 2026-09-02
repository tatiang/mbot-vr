/**
 * The single gate for the physical-robot feature.
 *
 * Off by default: this repository has not been validated against a real mBot (see
 * `docs/hardware-bridge-plan.md` §4, "Important unknowns"), so the hardware UI stays
 * dark until a teacher or developer deliberately turns it on. Every place that would
 * otherwise `import()` a device-layer module checks this first, so "off" means the code
 * is never downloaded - not merely hidden behind a disabled button.
 */

const STORAGE_KEY = 'mbotvr.hardware.enabled';
const QUERY_PARAM = 'hardware';

/**
 * True when the student/developer has explicitly opted into the hardware feature this
 * browser, via `?hardware=1` (which also persists the choice) or a prior visit that set
 * it. Never throws - a browser with storage disabled just sees the feature stay off.
 */
export function isHardwareFeatureEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(QUERY_PARAM);
    if (fromQuery === '1' || fromQuery === 'true') {
      localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    if (fromQuery === '0' || fromQuery === 'false') {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (private mode, locked-down profile) - default off.
    return false;
  }
}
