import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSerialPort } from '../src/device/SerialTransport';

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
