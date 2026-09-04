/**
 * Feature detection for the physical-robot layer.
 *
 * Kept separate from `featureFlag.ts` on purpose: the flag is "does the student want
 * this", capabilities are "can this browser actually do it". A student can want it in a
 * browser that cannot deliver it (Safari, Firefox) - that combination is exactly what
 * routes to the `browserUnsupported` UI state instead of a dead `requestPort()` call.
 */

import { hasWebBluetooth } from './BluetoothLeTransport';

/** True when `navigator.serial` exists at all - Chrome/Edge 89+ on desktop OSes. */
export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * True when `navigator.bluetooth` exists at all - Chrome/Edge on desktop and Android.
 * Owned by `BluetoothLeTransport.ts` and re-exported here rather than duplicated,
 * matching how `hasWebSerial` above is the single source of truth for Web Serial.
 */
export { hasWebBluetooth };

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
 * `usbAvailable` covers cable AND Bluetooth-Classic-RFCOMM link kinds - a dual-mode
 * module's SPP service is enumerated through the same `navigator.serial` API once the
 * device is paired at the OS level (see `docs/hardware-bridge-plan.md` §3), so there is
 * no separate capability flag for that. `bleAvailable` is a genuinely different browser
 * API (`navigator.bluetooth`) for the BLE-only Bluetooth link kind (`'ble'`) - see
 * `BluetoothLeTransport.ts`. Whether an *individual* module can actually be reached
 * (dual-mode SPP vs. BLE-only, or which GATT profile it exposes) is a per-robot question
 * resolved during `identifying`/connect, not a browser capability.
 */
export interface DeviceCapabilities {
  usbAvailable: boolean;
  bleAvailable: boolean;
  secureContext: boolean;
}

export function detectCapabilities(): DeviceCapabilities {
  return {
    usbAvailable: hasWebSerial(),
    bleAvailable: hasWebBluetooth(),
    secureContext: isSecureContext(),
  };
}

/** Whether the connect flow should be offered at all - either transport API will do. */
export function canOfferHardware(caps: DeviceCapabilities): boolean {
  return (caps.usbAvailable || caps.bleAvailable) && caps.secureContext;
}
