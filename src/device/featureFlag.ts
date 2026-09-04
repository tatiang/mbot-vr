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

const WIRELESS_STORAGE_KEY = 'mbotvr.wireless.enabled';
const WIRELESS_QUERY_PARAM = 'wireless';

/**
 * Off by default (unlike `isHardwareFeatureEnabled` above) - hides both Bluetooth
 * connect options ("Connect Bluetooth" / Web Bluetooth, and the older RFCOMM option)
 * from the "My robot" panel, leaving the cable as the only physical-robot connection
 * students see. Turned off 2026-09-04: real classroom testing hit a Bluetooth
 * connection that never resolved cleanly (see `docs/bluetooth-le-bridge.md`'s
 * real-hardware findings - likely a managed-Chrome policy layer specific to that
 * deployment, not a bug in this code) and the maintainer asked for it hidden rather
 * than the code removed, since the transport itself may simply need a different
 * Chrome policy configuration, or work fine on a different fleet.
 *
 * Deliberately NOT gating whether the Bluetooth code is *downloaded* the way
 * `isHardwareFeatureEnabled` gates the whole hardware layer - this only controls
 * whether the buttons are shown, so re-enabling it for a future test is a URL
 * parameter, not a redeploy. `?wireless=1` shows it (and persists that); `?wireless=0`
 * hides it again explicitly. Same never-throws-on-storage-unavailable behavior as
 * `isHardwareFeatureEnabled`.
 */
export function isWirelessFeatureEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(WIRELESS_QUERY_PARAM);
    if (fromQuery === '1' || fromQuery === 'true') {
      localStorage.setItem(WIRELESS_STORAGE_KEY, '1');
      return true;
    }
    if (fromQuery === '0' || fromQuery === 'false') {
      localStorage.removeItem(WIRELESS_STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(WIRELESS_STORAGE_KEY) === '1';
  } catch {
    return false;
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
