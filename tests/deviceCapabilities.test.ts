import { describe, expect, it } from 'vitest';
import { canOfferHardware, detectCapabilities, hasWebSerial, isSecureContext } from '../src/device/capabilities';

describe('capability detection under Node (no browser globals)', () => {
  it('hasWebSerial is false with no navigator.serial', () => {
    expect(hasWebSerial()).toBe(false);
  });

  it('isSecureContext is false with no window', () => {
    expect(isSecureContext()).toBe(false);
  });

  it('detectCapabilities reflects both', () => {
    expect(detectCapabilities()).toEqual({ usbAvailable: false, secureContext: false });
  });

  it('canOfferHardware requires both capabilities', () => {
    expect(canOfferHardware({ usbAvailable: true, secureContext: false })).toBe(false);
    expect(canOfferHardware({ usbAvailable: false, secureContext: true })).toBe(false);
    expect(canOfferHardware({ usbAvailable: true, secureContext: true })).toBe(true);
  });
});
