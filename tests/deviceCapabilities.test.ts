import { describe, expect, it } from 'vitest';
import { canOfferHardware, detectCapabilities, hasWebBluetooth, hasWebSerial, isSecureContext } from '../src/device/capabilities';

describe('capability detection under Node (no browser globals)', () => {
  it('hasWebSerial is false with no navigator.serial', () => {
    expect(hasWebSerial()).toBe(false);
  });

  it('hasWebBluetooth is false with no navigator.bluetooth', () => {
    expect(hasWebBluetooth()).toBe(false);
  });

  it('isSecureContext is false with no window', () => {
    expect(isSecureContext()).toBe(false);
  });

  it('detectCapabilities reflects all three', () => {
    expect(detectCapabilities()).toEqual({ usbAvailable: false, bleAvailable: false, secureContext: false });
  });

  it('canOfferHardware needs a secure context and at least one transport', () => {
    expect(canOfferHardware({ usbAvailable: true, bleAvailable: false, secureContext: false })).toBe(false);
    expect(canOfferHardware({ usbAvailable: false, bleAvailable: false, secureContext: true })).toBe(false);
    expect(canOfferHardware({ usbAvailable: true, bleAvailable: false, secureContext: true })).toBe(true);
  });

  it('canOfferHardware accepts BLE alone (a Web-Serial-less, Web-Bluetooth-only browser)', () => {
    expect(canOfferHardware({ usbAvailable: false, bleAvailable: true, secureContext: true })).toBe(true);
  });

  it('canOfferHardware accepts either transport, but never without a secure context', () => {
    expect(canOfferHardware({ usbAvailable: true, bleAvailable: true, secureContext: false })).toBe(false);
  });
});
