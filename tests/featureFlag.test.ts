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
  it('is off by default', () => {
    expect(isHardwareFeatureEnabled()).toBe(false);
  });

  it('turns on and persists when ?hardware=1 is present', () => {
    setLocation('?hardware=1');
    expect(isHardwareFeatureEnabled()).toBe(true);
    expect(storage.getItem('mbotvr.hardware.enabled')).toBe('1');
  });

  it('stays on for a later visit with no query param, once persisted', () => {
    setLocation('?hardware=1');
    isHardwareFeatureEnabled();
    setLocation('');
    expect(isHardwareFeatureEnabled()).toBe(true);
  });

  it('turns off and clears storage when ?hardware=0 is present', () => {
    setLocation('?hardware=1');
    isHardwareFeatureEnabled();
    setLocation('?hardware=0');
    expect(isHardwareFeatureEnabled()).toBe(false);
    expect(storage.getItem('mbotvr.hardware.enabled')).toBeNull();
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
      expect(isHardwareFeatureEnabled()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
    }
  });
});
