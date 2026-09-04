/**
 * An in-memory Web Bluetooth GATT device for testing `BluetoothLeTransport.ts` without
 * a browser - the same pattern `fakeSerialLink.ts` uses for `SerialLink`/USB. Not a
 * `.test.ts` file, so vitest's `include` pattern does not try to run it as a suite.
 */

class FakeCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  value?: DataView;
  writes: Uint8Array[] = [];
  service!: BluetoothRemoteGATTService;
  private failWrites = false;

  constructor(uuid: string, properties: Partial<BluetoothCharacteristicProperties> = {}) {
    super();
    this.uuid = uuid;
    this.properties = { write: false, writeWithoutResponse: false, notify: false, read: false, ...properties };
  }

  /** Makes every subsequent write reject, to test `ERR_BLE_WRITE_FAILED` handling. */
  breakWrites(): void {
    this.failWrites = true;
  }

  private record(chunk: Uint8Array): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('simulated GATT write failure'));
    this.writes.push(Uint8Array.from(chunk));
    return Promise.resolve();
  }

  writeValue(chunk: Uint8Array): Promise<void> {
    return this.record(chunk);
  }
  writeValueWithResponse(chunk: Uint8Array): Promise<void> {
    return this.record(chunk);
  }
  writeValueWithoutResponse(chunk: Uint8Array): Promise<void> {
    return this.record(chunk);
  }
  async startNotifications(): Promise<BluetoothRemoteGATTCharacteristic> {
    return this as unknown as BluetoothRemoteGATTCharacteristic;
  }
  async stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic> {
    return this as unknown as BluetoothRemoteGATTCharacteristic;
  }

  /** Simulates the peripheral sending bytes: fires `characteristicvaluechanged`. */
  emitNotification(bytes: Uint8Array): void {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService extends EventTarget {
  readonly uuid: string;
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  constructor(uuid: string) {
    super();
    this.uuid = uuid;
  }

  addCharacteristic(characteristic: FakeCharacteristic): void {
    characteristic.service = this as unknown as BluetoothRemoteGATTService;
    this.characteristics.set(characteristic.uuid, characteristic);
  }

  async getCharacteristic(id: string | number): Promise<BluetoothRemoteGATTCharacteristic> {
    const found = this.characteristics.get(String(id));
    if (!found) throw new Error(`no such characteristic: ${id}`);
    return found as unknown as BluetoothRemoteGATTCharacteristic;
  }
}

class FakeServer {
  connected = true;
  device!: BluetoothDevice;
  disconnectCalls = 0;
  private readonly services = new Map<string, FakeService>();

  addService(service: FakeService): void {
    this.services.set(service.uuid, service);
  }

  async connect(): Promise<BluetoothRemoteGATTServer> {
    this.connected = true;
    return this as unknown as BluetoothRemoteGATTServer;
  }

  disconnect(): void {
    this.connected = false;
    this.disconnectCalls += 1;
  }

  async getPrimaryService(id: string | number): Promise<BluetoothRemoteGATTService> {
    const found = this.services.get(String(id));
    if (!found) throw new Error(`no such service: ${id}`);
    return found as unknown as BluetoothRemoteGATTService;
  }
}

class FakeDevice extends EventTarget {
  readonly id = 'fake-ble-device';
  readonly name = 'Makeblock_LE';
  gatt: FakeServer;

  constructor(gatt: FakeServer) {
    super();
    this.gatt = gatt;
    gatt.device = this as unknown as BluetoothDevice;
  }

  triggerDisconnect(): void {
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

export interface FakeBleDeviceOptions {
  serviceUuid: string;
  notifyUuid: string;
  writeUuid: string;
  writeWithoutResponse?: boolean;
}

export interface FakeBleDevice {
  device: BluetoothDevice;
  fakeDevice: FakeDevice;
  server: FakeServer;
  notify: FakeCharacteristic;
  write: FakeCharacteristic;
}

/** Builds a fake device exposing exactly one GATT profile - one of `CANDIDATE_PROFILES`' shapes. */
export function createFakeBleDevice(options: FakeBleDeviceOptions): FakeBleDevice {
  const server = new FakeServer();
  const service = new FakeService(options.serviceUuid);
  const notify = new FakeCharacteristic(options.notifyUuid, { notify: true });
  const combined = options.notifyUuid === options.writeUuid;
  if (combined) {
    Object.assign(notify.properties, { write: true, writeWithoutResponse: options.writeWithoutResponse ?? true });
  }
  const write = combined
    ? notify
    : new FakeCharacteristic(options.writeUuid, { write: true, writeWithoutResponse: options.writeWithoutResponse ?? true });
  service.addCharacteristic(notify);
  if (!combined) service.addCharacteristic(write);
  server.addService(service);
  const fakeDevice = new FakeDevice(server);
  return { device: fakeDevice as unknown as BluetoothDevice, fakeDevice, server, notify, write };
}

/** A device whose `gatt` is undefined - the `ERR_BLE_GATT_UNAVAILABLE` case. */
export function createGattlessDevice(): BluetoothDevice {
  const device = new EventTarget() as unknown as BluetoothDevice;
  Object.defineProperty(device, 'gatt', { value: undefined });
  return device;
}
