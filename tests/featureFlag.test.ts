import { beforeEach, describe, expect, it } from 'vitest';
import { isHardwareFeatureEnabled } from '../src/device/featureFlag';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;

function setLocation(search: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search } },
  });
}

beforeEach(() => {
  storage.clear();
  setLocation('');
});

describe('isHardwareFeatureEnabled', () => {
  it('is on by default', () => {
    expect(isHardwareFeatureEnabled()).toBe(true);
  });

  it('turns on and clears a previous opt-out when ?hardware=1 is present', () => {
    storage.setItem('mbotvr.hardware.enabled', '0');
    setLocation('?hardware=1');
    expect(isHardwareFeatureEnabled()).toBe(true);
    expect(storage.getItem('mbotvr.hardware.enabled')).toBeNull();
  });

  it('stays off for a later visit with no query param, once opted out', () => {
    setLocation('?hardware=0');
    isHardwareFeatureEnabled();
    setLocation('');
    expect(isHardwareFeatureEnabled()).toBe(false);
  });

  it('turns off and stores the opt-out when ?hardware=0 is present', () => {
    setLocation('?hardware=0');
    expect(isHardwareFeatureEnabled()).toBe(false);
    expect(storage.getItem('mbotvr.hardware.enabled')).toBe('0');
  });

  it('never throws when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(() => isHardwareFeatureEnabled()).not.toThrow();
      expect(isHardwareFeatureEnabled()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    }
  });
});
