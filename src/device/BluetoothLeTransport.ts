import { DeviceError } from './types';
import type { SerialLink } from './SerialTransport';

/**
 * A Web Bluetooth (GATT) transport for mBot's BLE-only Bluetooth module (the module
 * printed "Bluetooth BLEV1.0" - Makeblock's single-mode BLE module, FCC id
 * 2AH9Q-BLEV1-C - as distinct from the dual-mode BR/EDR+BLE module `SerialTransport.ts`
 * already reaches over Web Serial's Bluetooth-RFCOMM support). A BLE-only module has no
 * SPP service to expose, so it never appears in that RFCOMM path's port chooser at all -
 * this file is the other half `docs/hardware-bridge-plan.md`'s U4 always said a BLE-only
 * module would need.
 *
 * CONFIDENCE NOTE - read before changing the UUIDs below.
 * ---------------------------------------------------------------------------------
 * No source found during this work specifically documents BLEV1-C's GATT profile by
 * name. What exists is several independent, consistent secondhand reports that
 * Makeblock's mBot BLE module (unqualified - not confirmed to be this exact part
 * number) exposes a UART-bridge service at 0xFFE1 with a notify characteristic at
 * 0xFFE2 and a write characteristic at 0xFFE3, forwarding bytes transparently to the
 * mCore's hardware serial port - i.e. the *exact same* `0xFF 0x55` byte protocol this
 * app already speaks over USB and RFCOMM, just tunnelled through GATT instead of a
 * byte stream. Sources (all secondhand, none is Makeblock's own spec):
 *   - Makeblock forum, "Bluetooth Low Energy specs question"
 *     https://forum.makeblock.com/t/bluetooth-low-energy-specs-question/4156
 *   - "MakeBlock STEM mbot Robot - Using nodeJS to control mbot through BLE"
 *     https://primalcortex.wordpress.com/2018/07/05/makeblock-mbot-nodejs-ble/
 *   - community.appinventor.mit.edu, "ServiceUUID and CharacteristicUUID after connection"
 *   - github-wiki-see.page mirror of Ted-CAcert/mymbot's wiki, "Bluetooth Module für mBot V1"
 *
 * Because that is not confirmed against the specific hardware this app will be tested
 * against, `openBleLink()` tries several *candidate* GATT profiles in order (see
 * `CANDIDATE_PROFILES`) once a device is connected, rather than betting everything on
 * one guess - if none match, connecting fails loudly with `ERR_BLE_SERVICE_NOT_FOUND`
 * and a diagnostic log entry naming every UUID that was tried, not a silent wrong guess.
 *
 * A second, harder assumption already failed once on real hardware and is fixed:
 * `requestBleDevice()` originally scoped the chooser with `filters: [{services:
 * [...]}]` for those same candidate UUIDs, expecting it to both narrow the list and
 * only work against a device advertising one of them. Against a real "Bluetooth
 * BLEV1.0" module the chooser came back completely empty - `filters` only matches a
 * peripheral's *advertising payload*, not its GATT table, and this module (like many
 * cheap BLE-UART bridges) apparently doesn't put a custom service UUID in its
 * advertisement. `requestBleDevice()` now asks for `acceptAllDevices: true` instead -
 * see its own comment for the reasoning and what would justify re-narrowing it later.
 *
 * Update `docs/hardware-bridge-plan.md`'s Implementation status with whichever profile
 * actually worked on real hardware, the same way every other protocol fact in this app
 * was confirmed.
 */

/** One GATT "shape" this module knows how to try. First match wins. */
interface BleProfile {
  name: string;
  service: string;
  notify: string;
  write: string;
}

const CANDIDATE_PROFILES: BleProfile[] = [
  {
    // Makeblock's own mBot BLE module, per the sources above.
    name: 'makeblock-ffe1',
    service: '0000ffe1-0000-1000-8000-00805f9b34fb',
    notify: '0000ffe2-0000-1000-8000-00805f9b34fb',
    write: '0000ffe3-0000-1000-8000-00805f9b34fb',
  },
  {
    // A very common generic BLE-UART bridge shape (HM-10/CC41-A family and rebadges),
    // where one characteristic does both notify and write. Included because cheap BLE
    // modules are frequently OEM'd from this same reference design.
    name: 'hm10-ffe0',
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    notify: '0000ffe1-0000-1000-8000-00805f9b34fb',
    write: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
  {
    // Nordic UART Service - another common BLE-UART bridge shape, in case the module's
    // radio SoC is a Nordic part advertising its reference profile unmodified.
    name: 'nordic-uart',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  },
];

/**
 * Conservative default ATT MTU payload (23-byte ATT MTU minus the 3-byte write-request
 * header = 20 usable bytes) - safe on any BLE stack regardless of whether a larger MTU
 * was negotiated. Web Bluetooth has no cross-browser way to read the negotiated MTU, so
 * this is deliberately not tuned to "what Chrome on macOS usually negotiates" - a
 * program-storage chunk (up to 38 bytes, see `docs/player-protocol.md`) will be split
 * into two or three BLE writes rather than risk one being silently truncated.
 */
export const BLE_MAX_CHUNK_BYTES = 20;

export function hasWebBluetooth(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && Boolean(navigator.bluetooth);
}

/**
 * Opens the browser's Bluetooth device chooser.
 *
 * The first version of this function scoped the chooser with `filters: [{services:
 * [...]}]` for each candidate profile's service UUID, on the theory that it would both
 * narrow the list (no phone earbuds, no debug console) and only work at all against a
 * device actually advertising one of those services. Real-hardware testing against a
 * "Bluetooth BLEV1.0" module immediately falsified the premise: the chooser came back
 * completely empty, not just missing our device. `filters: [{services}]` only matches
 * against what a peripheral puts in its *advertising/scan-response payload* - it says
 * nothing about what GATT services the device actually exposes once connected, and
 * plenty of cheap/rebranded BLE-UART bridges (this module very possibly among them)
 * advertise only a name, expecting a central to connect blind and discover services
 * afterward. Web Bluetooth's `filters` option has no way to express that.
 *
 * So this now requests `acceptAllDevices: true` - every nearby BLE device, unfiltered -
 * which cannot be "wrong" the way a service-UUID or name-prefix guess could be, at the
 * cost of a noisier chooser (a classroom's phones, earbuds, etc. will show up too;
 * picking the actual robot is on the student, same as it already is for an unfiltered
 * "show all ports" USB fallback). `optionalServices` is unaffected by this and still
 * lists every candidate profile's service UUID - that is what grants `openBleLink` real
 * access to try each one via `getPrimaryService()` after connecting, regardless of
 * whether the device was found via a filter or not. If a future round confirms the
 * module's real advertised name, re-narrowing to `filters: [{ namePrefix: '...' }]`
 * would be a safe, evidence-based tightening - not the blind guess this started as.
 */
export async function requestBleDevice(): Promise<BluetoothDevice> {
  if (!hasWebBluetooth()) {
    throw new DeviceError('ERR_BROWSER_UNSUPPORTED', 'This browser has no navigator.bluetooth.');
  }
  const services = CANDIDATE_PROFILES.map((profile) => profile.service);
  try {
    return await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices: services,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new DeviceError('ERR_NO_PORT_SELECTED', 'The Bluetooth chooser was dismissed.', error);
    }
    throw new DeviceError('ERR_PERMISSION_DENIED', 'Bluetooth permission was not granted.', error);
  }
}

function toUint8Array(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

async function connectProfile(
  server: BluetoothRemoteGATTServer,
  profile: BleProfile,
): Promise<{ notify: BluetoothRemoteGATTCharacteristic; write: BluetoothRemoteGATTCharacteristic } | null> {
  try {
    const service = await server.getPrimaryService(profile.service);
    const notify = await service.getCharacteristic(profile.notify);
    const write = await service.getCharacteristic(profile.write);
    return { notify, write };
  } catch {
    return null; // this candidate doesn't match the connected device - try the next one
  }
}

/**
 * Connects `device`'s GATT server, finds the first candidate profile that actually
 * resolves, subscribes to notifications, and wraps the result as a `SerialLink` -
 * the same interface `SerialTransport.ts` implements for USB and RFCOMM, so
 * `DeviceSession`, `MakeblockProtocol`'s `FrameParser`, `StopController` and
 * `ProgramRunner` all work against a BLE-connected robot completely unchanged. GATT has
 * no DTR/RTS-equivalent control lines, so `setSignals` is a documented no-op - the
 * `pulseReset()` step of the stop escalation ladder's DTR pulse (see `StopController.ts`
 * §9 step 4) has no effect over this link; the halt-frame and RESET-frame steps before
 * it are unaffected and remain the primary stop mechanism.
 */
export async function openBleLink(device: BluetoothDevice, onLog?: (message: string) => void): Promise<SerialLink> {
  if (!device.gatt) {
    throw new DeviceError('ERR_BLE_GATT_UNAVAILABLE', 'This device has no GATT server.');
  }

  let server: BluetoothRemoteGATTServer;
  try {
    server = await device.gatt.connect();
  } catch (error) {
    throw new DeviceError('ERR_BLE_CONNECT_FAILED', 'Could not connect to the Bluetooth device.', error);
  }

  let matched: { profile: BleProfile; notify: BluetoothRemoteGATTCharacteristic; write: BluetoothRemoteGATTCharacteristic } | null =
    null;
  for (const profile of CANDIDATE_PROFILES) {
    const found = await connectProfile(server, profile);
    if (found) {
      matched = { profile, ...found };
      break;
    }
  }
  if (!matched) {
    const tried = CANDIDATE_PROFILES.map((p) => p.name).join(', ');
    server.disconnect();
    throw new DeviceError('ERR_BLE_SERVICE_NOT_FOUND', `No known GATT profile matched this device (tried: ${tried}).`);
  }
  onLog?.(`Bluetooth GATT profile matched: ${matched.profile.name}`);

  try {
    await matched.notify.startNotifications();
  } catch (error) {
    server.disconnect();
    throw new DeviceError('ERR_BLE_CHARACTERISTIC_NOT_FOUND', 'Could not subscribe to Bluetooth notifications.', error);
  }

  const dataHandlers = new Set<(bytes: Uint8Array) => void>();
  const disconnectHandlers = new Set<() => void>();
  let closed = false;

  const notifyDisconnect = () => {
    if (closed) return;
    for (const handler of disconnectHandlers) handler();
  };

  const onValueChanged = () => {
    const value = matched!.notify.value;
    if (value && value.byteLength > 0) {
      const bytes = toUint8Array(value);
      for (const handler of dataHandlers) handler(bytes);
    }
  };
  matched.notify.addEventListener('characteristicvaluechanged', onValueChanged);
  device.addEventListener('gattserverdisconnected', notifyDisconnect);

  // The same "one write at a time" discipline `SerialTransport.ts` uses for USB/RFCOMM -
  // see the comment there for the real regression (concurrent motor writes) it fixes.
  // Here it also keeps chunk order correct, which matters more over BLE: an
  // out-of-order chunk pair is a corrupted frame, not just a lock exception.
  let writeChain: Promise<void> = Promise.resolve();
  const writeChunk = matched.write.properties.writeWithoutResponse
    ? (chunk: Uint8Array) => matched!.write.writeValueWithoutResponse!(chunk)
    : (chunk: Uint8Array) => matched!.write.writeValue(chunk);

  return {
    write(bytes) {
      const task = writeChain.then(async () => {
        try {
          for (let offset = 0; offset < bytes.length; offset += BLE_MAX_CHUNK_BYTES) {
            const chunk = bytes.subarray(offset, offset + BLE_MAX_CHUNK_BYTES);
            await writeChunk(chunk);
          }
        } catch (error) {
          throw error instanceof DeviceError ? error : new DeviceError('ERR_BLE_WRITE_FAILED', 'Bluetooth write failed.', error);
        }
      });
      writeChain = task.catch(() => undefined);
      return task;
    },
    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
    // No DTR/RTS equivalent over GATT - see the doc comment on this function.
    async setSignals() {},
    async close() {
      closed = true;
      matched!.notify.removeEventListener('characteristicvaluechanged', onValueChanged);
      device.removeEventListener('gattserverdisconnected', notifyDisconnect);
      try {
        server.disconnect();
      } catch {
        // Already gone - nothing to clean up.
      }
    },
  };
}
