/**
 * The single gate for the physical-robot feature.
 *
 * On by default now that tethered USB control and the safety stop ladder have both
 * been validated against real hardware. Every place that would otherwise `import()` a
 * device-layer module checks this first, so an explicit opt-out still means the code is
 * never downloaded - not merely hidden behind a disabled button.
 */

const STORAGE_KEY = 'mbotvr.hardware.enabled';
const QUERY_PARAM = 'hardware';

/**
 * True unless the student/developer has explicitly opted out of the hardware feature
 * via `?hardware=0` (which persists the choice) or localStorage. `?hardware=1` clears a
 * prior opt-out. Never throws - a browser with storage disabled gets the default-on
 * experience.
 */
export function isHardwareFeatureEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(QUERY_PARAM);
    if (fromQuery === '1' || fromQuery === 'true') {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    }
    if (fromQuery === '0' || fromQuery === 'false') {
      localStorage.setItem(STORAGE_KEY, '0');
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    // Storage unavailable (private mode, locked-down profile) - use the default.
    return true;
  }
}

const DEBUG_QUERY_PARAM = 'debug';

/**
 * Off by default, on only via `?debug=1` in the URL - never persisted, so it never
 * survives a shared/managed Chromebook's next session by accident. Gates the raw
 * connection/actuator test controls in `DeviceDebugPanel.tsx` (per-motor test, raw
 * sensor reads) that have no business being one click away from a student mid-class -
 * see the "DEBUG PANEL" section of the Bluetooth work this gates.
 */
export function isHardwareDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get(DEBUG_QUERY_PARAM);
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}
