/**
 * Minimal ambient types for the Web Bluetooth API.
 *
 * Same rationale as `webSerial.d.ts`: TypeScript's bundled DOM lib does not ship these
 * (no first-party `@types/web-bluetooth` is installed either - see the note in
 * `src/device/BluetoothLeTransport.ts`), so only the handful of members that file
 * actually calls are declared here. Chrome/Edge on desktop and Android implement this;
 * Safari and Firefox do not, which is why every call site feature-detects with
 * `'bluetooth' in navigator` first (see `src/device/capabilities.ts`).
 */

interface BluetoothLEScanFilter {
  services?: (string | number)[];
  name?: string;
  namePrefix?: string;
}

interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  optionalServices?: (string | number)[];
  acceptAllDevices?: boolean;
}

interface BluetoothCharacteristicProperties {
  readonly write: boolean;
  readonly writeWithoutResponse: boolean;
  readonly notify: boolean;
  readonly read: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value?: DataView;
  readonly service: BluetoothRemoteGATTService;
  // Typed as plain `Uint8Array` rather than `BufferSource` - `BluetoothLeTransport.ts`
  // only ever passes `Uint8Array.subarray()` results, and TS's DOM lib types
  // `BufferSource` as generic over `ArrayBuffer` specifically, which a `Uint8Array`
  // backed by the general `ArrayBufferLike` (as `subarray()` returns) does not satisfy.
  writeValue(value: Uint8Array): Promise<void>;
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService extends EventTarget {
  readonly uuid: string;
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  readonly device: BluetoothDevice;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface Bluetooth extends EventTarget {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
}

interface Navigator {
  readonly bluetooth?: Bluetooth;
}
