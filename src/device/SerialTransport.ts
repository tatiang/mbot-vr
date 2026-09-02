import { DeviceError, type LinkKind } from './types';

/**
 * The standard Bluetooth Serial Port Profile service class UUID. Passed as
 * `allowedBluetoothServiceClassIds` when a student chooses "Wireless (Bluetooth)", so
 * the port chooser surfaces a paired dual-mode Makeblock Bluetooth module (see
 * `docs/hardware-bridge-plan.md` §3, source 11-12). A BLE-only module has no SPP
 * service to expose and simply will not appear in the list - that is the honest
 * `ERR_NO_PORTS_FOUND` outcome for U4's "which module is fitted" question, not a bug.
 */
const SPP_SERVICE_CLASS_ID = '00001101-0000-1000-8000-00805f9b34fb';

/**
 * USB vendor id for WCH (Nanjing Qinheng Microelectronics), maker of the CH340/CH341
 * chip the mCore board uses for its USB-serial bridge (see
 * `docs/hardware-bridge-plan.md` §3, source 1-2). Passed as a `filters` entry when a
 * student chooses "Plugged in with a cable", so Chrome's port chooser shows only
 * WCH-made adapters instead of every serial-capable device the OS knows about - on a
 * real machine that list can include Bluetooth-paired earbuds, a debug console, and
 * other USB-serial gadgets with no relation to the robot, which is exactly what caused
 * real confusion during hardware testing on 2 September 2026. A vendor filter (rather
 * than vendor+product) still shows both CH340 (product 0x7523) and CH341
 * (product 0x5523) variants.
 */
const WCH_USB_VENDOR_ID = 0x1a86;

/**
 * The narrow surface `DeviceSession` needs from a serial connection.
 *
 * Keeping this as an interface - rather than passing a raw `SerialPort` around - is
 * what makes `DeviceSession` testable without a browser: tests construct a small fake
 * that implements `SerialLink` directly (see `tests/deviceSession.test.ts`), the same
 * way `tests/programRunner.test.ts` fakes the `Worker` global rather than mocking
 * `postMessage` calls individually.
 */
export interface SerialLink {
  write(bytes: Uint8Array): Promise<void>;
  /** Registers a byte-chunk listener; returns a function that unregisters it. */
  onData(handler: (bytes: Uint8Array) => void): () => void;
  /** Registers a listener for the link going away, however that is discovered. */
  onDisconnect(handler: () => void): () => void;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  close(): Promise<void>;
}

/**
 * The mCore's factory firmware baud rate. Both the USB (CH340) and Bluetooth RFCOMM
 * paths use the same rate - Bluetooth serial is a transparent pipe to the same UART the
 * cable talks to.
 */
export const SERIAL_BAUD_RATE = 115200;

/**
 * Throws `ERR_BROWSER_UNSUPPORTED` in any environment without Web Serial. By default a
 * USB request is filtered to WCH (CH340/CH341) devices - pass `showAllPorts: true` for
 * the "not listed? show all ports" fallback, so a robot on genuinely different
 * USB-serial hardware is never permanently hidden by the filter.
 */
export async function requestSerialPort(
  kind: LinkKind = 'usb',
  options: { showAllPorts?: boolean } = {},
): Promise<SerialPort> {
  if (typeof navigator === 'undefined' || !navigator.serial) {
    throw new DeviceError('ERR_BROWSER_UNSUPPORTED', 'This browser has no navigator.serial.');
  }
  const requestOptions: SerialPortRequestOptions | undefined =
    kind === 'bluetooth'
      ? { allowedBluetoothServiceClassIds: [SPP_SERVICE_CLASS_ID] }
      : options.showAllPorts
        ? undefined
        : { filters: [{ usbVendorId: WCH_USB_VENDOR_ID }] };
  try {
    return await navigator.serial.requestPort(requestOptions);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new DeviceError('ERR_NO_PORT_SELECTED', 'The port chooser was dismissed.', error);
    }
    throw new DeviceError('ERR_PERMISSION_DENIED', 'Serial port permission was not granted.', error);
  }
}

/**
 * Opens `port` and wraps it as a `SerialLink`.
 *
 * The read loop is started here and runs for the link's lifetime, pumping bytes to
 * every registered `onData` handler; a read error or a closed stream is treated as a
 * disconnect, since the Web Serial spec gives no more specific signal for "the cable
 * was pulled" than the readable stream ending.
 */
export async function openSerialLink(port: SerialPort): Promise<SerialLink> {
  try {
    await port.open({ baudRate: SERIAL_BAUD_RATE, bufferSize: 4096 });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      throw new DeviceError('ERR_PORT_BUSY', 'This port is already open elsewhere.', error);
    }
    throw new DeviceError('ERR_PORT_OPEN_FAILED', 'The port could not be opened.', error);
  }

  const dataHandlers = new Set<(bytes: Uint8Array) => void>();
  const disconnectHandlers = new Set<() => void>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;

  const notifyDisconnect = () => {
    if (closed) return;
    for (const handler of disconnectHandlers) handler();
  };

  const pump = async () => {
    if (!port.readable) return;
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          for (const handler of dataHandlers) handler(value);
        }
      }
    } catch {
      // A read error is how a pulled cable / lost Bluetooth link usually surfaces.
    } finally {
      reader?.releaseLock();
      reader = null;
      notifyDisconnect();
    }
  };

  void pump();

  return {
    async write(bytes) {
      if (!port.writable) {
        throw new DeviceError('ERR_LINK_LOST', 'The port has no writable stream.');
      }
      const writer = port.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    onData(handler) {
      dataHandlers.add(handler);
      return () => dataHandlers.delete(handler);
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
    async setSignals(signals) {
      await port.setSignals(signals);
    },
    async close() {
      closed = true;
      try {
        await reader?.cancel();
      } catch {
        // Already gone - nothing to clean up.
      }
      try {
        await port.close();
      } catch {
        // Already closed.
      }
    },
  };
}
