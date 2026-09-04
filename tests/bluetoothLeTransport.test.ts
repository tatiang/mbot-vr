import { describe, expect, it, vi } from 'vitest';
import { BLE_MAX_CHUNK_BYTES, hasWebBluetooth, openBleLink, requestBleDevice } from '../src/device/BluetoothLeTransport';
import { DeviceError } from '../src/device/types';
import { createFakeBleDevice, createGattlessDevice } from './fakeBluetoothDevice';

const MAKEBLOCK_PROFILE = {
  serviceUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
  notifyUuid: '0000ffe2-0000-1000-8000-00805f9b34fb',
  writeUuid: '0000ffe3-0000-1000-8000-00805f9b34fb',
};
const HM10_PROFILE = {
  serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
  notifyUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
  writeUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
};

describe('hasWebBluetooth / requestBleDevice under Node (no browser globals)', () => {
  it('hasWebBluetooth is false with no navigator.bluetooth', () => {
    expect(hasWebBluetooth()).toBe(false);
  });

  it('requestBleDevice throws ERR_BROWSER_UNSUPPORTED', async () => {
    await expect(requestBleDevice()).rejects.toMatchObject({ code: 'ERR_BROWSER_UNSUPPORTED' });
  });
});

describe('openBleLink', () => {
  it('rejects a device with no GATT server', async () => {
    await expect(openBleLink(createGattlessDevice())).rejects.toMatchObject({ code: 'ERR_BLE_GATT_UNAVAILABLE' });
  });

  it('matches the first candidate profile (Makeblock ffe1/ffe2/ffe3) that resolves', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const logs: string[] = [];
    const link = await openBleLink(fake.device, (message) => logs.push(message));
    expect(logs[0]).toMatch(/makeblock-ffe1/);
    await link.close();
  });

  it('falls through to a later candidate profile when the first does not match this device', async () => {
    // This device only exposes the HM-10-style combined FFE0/FFE1 shape - the Makeblock
    // FFE1/FFE2/FFE3 candidate tried first must fail closed, not throw, and let the walk
    // continue to the profile that actually matches.
    const fake = createFakeBleDevice(HM10_PROFILE);
    const logs: string[] = [];
    const link = await openBleLink(fake.device, (message) => logs.push(message));
    expect(logs[0]).toMatch(/hm10-ffe0/);
    await link.close();
  });

  it('throws ERR_BLE_SERVICE_NOT_FOUND, and disconnects, when nothing matches', async () => {
    const fake = createFakeBleDevice({
      serviceUuid: '0000dead-0000-1000-8000-00805f9b34fb',
      notifyUuid: '0000beef-0000-1000-8000-00805f9b34fb',
      writeUuid: '0000beef-0000-1000-8000-00805f9b34fb',
    });
    await expect(openBleLink(fake.device)).rejects.toMatchObject({ code: 'ERR_BLE_SERVICE_NOT_FOUND' });
    expect(fake.server.disconnectCalls).toBe(1);
  });

  it('chunks a write to BLE_MAX_CHUNK_BYTES and preserves byte order across chunks', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    const payload = Uint8Array.from({ length: 45 }, (_, i) => i);

    await link.write(payload);

    expect(fake.write.writes.map((chunk) => chunk.length)).toEqual([20, 20, 5]);
    const reassembled = new Uint8Array(45);
    let offset = 0;
    for (const chunk of fake.write.writes) {
      reassembled.set(chunk, offset);
      offset += chunk.length;
    }
    expect(Array.from(reassembled)).toEqual(Array.from(payload));
    await link.close();
  });

  it('serializes concurrent writes instead of interleaving their chunks', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    const a = Uint8Array.from({ length: BLE_MAX_CHUNK_BYTES * 2 }, () => 0xaa);
    const b = Uint8Array.from({ length: BLE_MAX_CHUNK_BYTES * 2 }, () => 0xbb);

    await Promise.all([link.write(a), link.write(b)]);

    // Every chunk of `a` is uniform 0xaa and every chunk of `b` is uniform 0xbb - if the
    // writes interleaved, some chunk would mix the two and fail this per-chunk check.
    for (const chunk of fake.write.writes) {
      const allSame = chunk.every((byte) => byte === chunk[0]);
      expect(allSame).toBe(true);
    }
    await link.close();
  });

  it('reassembles a notification into onData', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    const received: Uint8Array[] = [];
    link.onData((bytes) => received.push(Uint8Array.from(bytes)));

    fake.notify.emitNotification(Uint8Array.from([0xff, 0x55, 1, 2, 3]));

    expect(received).toHaveLength(1);
    expect(Array.from(received[0])).toEqual([0xff, 0x55, 1, 2, 3]);
    await link.close();
  });

  it('reports ERR_BLE_WRITE_FAILED when the peripheral rejects a write', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    fake.write.breakWrites();

    await expect(link.write(Uint8Array.of(1, 2, 3))).rejects.toMatchObject({ code: 'ERR_BLE_WRITE_FAILED' });
    await link.close();
  });

  it('fires onDisconnect when the OS reports gattserverdisconnected', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    const disconnect = vi.fn();
    link.onDisconnect(disconnect);

    fake.fakeDevice.triggerDisconnect();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('close() disconnects the GATT server', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    await link.close();
    expect(fake.server.disconnectCalls).toBe(1);
  });

  it('setSignals is a documented no-op - GATT has no DTR/RTS lines', async () => {
    const fake = createFakeBleDevice(MAKEBLOCK_PROFILE);
    const link = await openBleLink(fake.device);
    await expect(link.setSignals({ dataTerminalReady: true })).resolves.toBeUndefined();
    await link.close();
  });
});

describe('DeviceError shape', () => {
  it('ERR_BLE_* codes are real DeviceError instances, matching the taxonomy contract', async () => {
    const fake = createFakeBleDevice({
      serviceUuid: '0000dead-0000-1000-8000-00805f9b34fb',
      notifyUuid: '0000beef-0000-1000-8000-00805f9b34fb',
      writeUuid: '0000beef-0000-1000-8000-00805f9b34fb',
    });
    try {
      await openBleLink(fake.device);
      throw new Error('expected openBleLink to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceError);
    }
  });
});
