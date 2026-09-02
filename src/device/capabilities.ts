/**
 * Feature detection for the physical-robot layer.
 *
 * Kept separate from `featureFlag.ts` on purpose: the flag is "does the student want
 * this", capabilities are "can this browser actually do it". A student can want it in a
 * browser that cannot deliver it (Safari, Firefox) - that combination is exactly what
 * routes to the `browserUnsupported` UI state instead of a dead `requestPort()` call.
 */

/** True when `navigator.serial` exists at all - Chrome/Edge 89+ on desktop OSes. */
export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Web Serial requires a secure context (HTTPS, or localhost during development).
 * `mbot-vr.vercel.app` satisfies this in production; a plain-HTTP LAN deployment would
 * not, which is worth surfacing rather than failing silently at `requestPort()`.
 */
export function isSecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

/**
 * Everything the connect flow needs to know before it offers a "Find my robot" button.
 * `usbAvailable` covers both link kinds - Bluetooth RFCOMM ports are enumerated through
 * the same `navigator.serial` API once the device is paired at the OS level (see
 * `docs/hardware-bridge-plan.md` §3), so there is no separate Bluetooth capability flag
 * here. Whether an *individual* Bluetooth module can be reached (dual-mode SPP vs.
 * BLE-only) is a per-robot question `DeviceSession` answers during `identifying`, not a
 * browser capability.
 */
export interface DeviceCapabilities {
  usbAvailable: boolean;
  secureContext: boolean;
}

export function detectCapabilities(): DeviceCapabilities {
  return {
    usbAvailable: hasWebSerial(),
    secureContext: isSecureContext(),
  };
}

/** Whether the connect flow should be offered at all. */
export function canOfferHardware(caps: DeviceCapabilities): boolean {
  return caps.usbAvailable && caps.secureContext;
}
