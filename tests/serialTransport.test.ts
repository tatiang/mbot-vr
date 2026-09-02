import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSerialLink, requestSerialPort } from '../src/device/SerialTransport';

/**
 * A `SerialPort`-shaped fake backed by *real* `WritableStream`/`ReadableStream`
 * instances, so it reproduces the actual browser behaviour a plain object mock
 * couldn't: `WritableStream.getWriter()` genuinely throws if the stream is already
 * locked. `write` is deliberately slow (a real `setTimeout`), giving two concurrent
 * `link.write()` calls a real window to race - which is exactly the bug real hardware
 * testing found in `SerialRobotRuntime.setMotors()`'s `Promise.all` of two writes.
 */
function createFakeSerialPort(): { port: SerialPort; writes: Uint8Array[] } {
  const writes: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(chunk);
      return new Promise((resolve) => setTimeout(resolve, 15));
    },
  });
  const readable = new ReadableStream<Uint8Array>({
    start() {
      // Never emits - this fake only needs to exist so the read pump doesn't throw.
    },
  });
  const port = {
    writable,
    readable,
    async open() {},
    async close() {},
    async setSignals() {},
    getInfo: () => ({}),
  } as unknown as SerialPort;
  return { port, writes };
}

describe('requestSerialPort', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('filters a USB request to the WCH vendor id by default', async () => {
    const fakePort = {} as SerialPort;
    const requestPort = vi.fn(async (_options?: SerialPortRequestOptions) => fakePort);
    vi.stubGlobal('navigator', { serial: { requestPort } });

    const port = await requestSerialPort('usb');

    expect(port).toBe(fakePort);
    expect(requestPort).toHaveBeenCalledWith({ filters: [{ usbVendorId: 0x1a86 }] });
  });

  it('shows every port when showAllPorts is set, so unusual hardware is never hidden', async () => {
    const requestPort = vi.fn(async (_options?: SerialPortRequestOptions) => ({}) as SerialPort);
    vi.stubGlobal('navigator', { serial: { requestPort } });

    await requestSerialPort('usb', { showAllPorts: true });

    expect(requestPort).toHaveBeenCalledWith(undefined);
  });

  it('filters a Bluetooth request to the standard SPP service class', async () => {
    const requestPort = vi.fn(async (_options?: SerialPortRequestOptions) => ({}) as SerialPort);
    vi.stubGlobal('navigator', { serial: { requestPort } });

    await requestSerialPort('bluetooth');

    expect(requestPort).toHaveBeenCalledWith({
      allowedBluetoothServiceClassIds: ['00001101-0000-1000-8000-00805f9b34fb'],
    });
  });

  it('maps a dismissed chooser (NotFoundError) to ERR_NO_PORT_SELECTED', async () => {
    const requestPort = vi.fn(async () => {
      throw new DOMException('cancelled', 'NotFoundError');
    });
    vi.stubGlobal('navigator', { serial: { requestPort } });

    await expect(requestSerialPort('usb')).rejects.toMatchObject({ code: 'ERR_NO_PORT_SELECTED' });
  });

  it('maps any other requestPort failure to ERR_PERMISSION_DENIED', async () => {
    const requestPort = vi.fn(async () => {
      throw new Error('denied by policy');
    });
    vi.stubGlobal('navigator', { serial: { requestPort } });

    await expect(requestSerialPort('usb')).rejects.toMatchObject({ code: 'ERR_PERMISSION_DENIED' });
  });

  it('throws ERR_BROWSER_UNSUPPORTED when navigator.serial does not exist', async () => {
    vi.stubGlobal('navigator', {});

    await expect(requestSerialPort('usb')).rejects.toMatchObject({ code: 'ERR_BROWSER_UNSUPPORTED' });
  });
});

describe('openSerialLink write serialization', () => {
  // Regression test for the bug real hardware testing found on 2 September 2026:
  // SerialRobotRuntime.setMotors() issues two writes via Promise.all, and the previous
  // implementation called port.writable.getWriter() fresh on every write() - which
  // throws if a previous write's writer lock hasn't been released yet. The symptom was
  // exactly this: one motor command went out and the other silently never did.
  it('lets two concurrent writes both succeed, in order, instead of the second throwing', async () => {
    const { port, writes } = createFakeSerialPort();
    const link = await openSerialLink(port);

    const left = new Uint8Array([1, 2, 3]);
    const right = new Uint8Array([4, 5, 6]);
    await expect(Promise.all([link.write(left), link.write(right)])).resolves.toEqual([undefined, undefined]);

    expect(writes).toHaveLength(2);
    expect(Array.from(writes[0])).toEqual([1, 2, 3]);
    expect(Array.from(writes[1])).toEqual([4, 5, 6]);
  });

  it('keeps serializing later writes even after an earlier one fails', async () => {
    const port = {
      writable: {
        getWriter: () => {
          throw new Error('locked');
        },
      },
      readable: new ReadableStream<Uint8Array>({ start() {} }),
      async open() {},
      async close() {},
      async setSignals() {},
      getInfo: () => ({}),
    } as unknown as SerialPort;
    const link = await openSerialLink(port);

    await expect(link.write(new Uint8Array([1]))).rejects.toBeTruthy();
    // A second write after a failed one must still attempt to run, not hang forever
    // waiting on a broken chain.
    await expect(link.write(new Uint8Array([2]))).rejects.toBeTruthy();
  });
});
