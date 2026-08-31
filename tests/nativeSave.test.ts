import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNativeSaveSupported,
  saveProjectToDisk,
  stripProjectExtension,
} from '../src/storage/nativeSave';
import { buildProjectFile, DEFAULT_SETTINGS } from '../src/storage/projectStore';

function sampleFile(name = 'My Robot Program') {
  return buildProjectFile({
    name,
    playground: 'grid',
    blockWorkspace: { blocks: { languageVersion: 0, blocks: [] } },
    customArena: null,
    settings: DEFAULT_SETTINGS,
  });
}

/** A stand-in for a FileSystemFileHandle, recording what got written to it. */
function fakeHandle(name: string) {
  const writes: string[] = [];
  let closed = false;
  return {
    name,
    handle: {
      name,
      async createWritable() {
        return {
          async write(data: string) {
            writes.push(data);
          },
          async close() {
            closed = true;
          },
        };
      },
    } as unknown as FileSystemFileHandle,
    writes,
    isClosed: () => closed,
  };
}

describe('isNativeSaveSupported', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false when the browser has no showSaveFilePicker (this test environment, Safari, Firefox)', () => {
    expect(isNativeSaveSupported()).toBe(false);
  });

  it('is true once a showSaveFilePicker function is present', () => {
    vi.stubGlobal('window', { showSaveFilePicker: async () => fakeHandle('x.json').handle });
    expect(isNativeSaveSupported()).toBe(true);
  });

  it('is false when the property exists but is not a function', () => {
    vi.stubGlobal('window', { showSaveFilePicker: 'not a function' });
    expect(isNativeSaveSupported()).toBe(false);
  });
});

describe('saveProjectToDisk', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('writes to an already-known handle without prompting again', async () => {
    const picker = vi.fn();
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    const existing = fakeHandle('robot.mbotvr.json');

    const outcome = await saveProjectToDisk(sampleFile(), existing.handle);

    expect(outcome.status).toBe('saved');
    expect(picker).not.toHaveBeenCalled();
    expect(existing.writes).toHaveLength(1);
    expect(existing.writes[0]).toContain('"name": "My Robot Program"');
    expect(existing.isClosed()).toBe(true);
  });

  it('prompts for a location when there is no existing handle, suggesting a sanitised filename', async () => {
    const target = fakeHandle('picked-name.mbotvr.json');
    const picker = vi.fn(async (_options?: SaveFilePickerOptions) => target.handle);
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const outcome = await saveProjectToDisk(sampleFile('My Robot Program'), null);

    expect(outcome.status).toBe('saved');
    expect(picker).toHaveBeenCalledTimes(1);
    const options = picker.mock.calls[0][0];
    expect(options?.suggestedName).toBe('My-Robot-Program.mbotvr.json');
    expect(target.writes).toHaveLength(1);
  });

  it('reports a cancelled dialog distinctly from a real error', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const outcome = await saveProjectToDisk(sampleFile(), null);

    expect(outcome).toEqual({ status: 'cancelled' });
  });

  it('reports a genuine failure as an error, not a silent no-op', async () => {
    const picker = vi.fn(async () => {
      throw new Error('disk is full');
    });
    vi.stubGlobal('window', { showSaveFilePicker: picker });

    const outcome = await saveProjectToDisk(sampleFile(), null);

    expect(outcome.status).toBe('error');
  });

  it('reports an error rather than throwing when the API is unavailable and no handle was given', async () => {
    vi.stubGlobal('window', {});

    const outcome = await saveProjectToDisk(sampleFile(), null);

    expect(outcome.status).toBe('error');
  });
});

describe('stripProjectExtension', () => {
  it('removes the compound .mbotvr.json extension', () => {
    expect(stripProjectExtension('My Project.mbotvr.json')).toBe('My Project');
  });

  it('removes a plain .json extension too, for a file the student renamed in the dialog', () => {
    expect(stripProjectExtension('My Project.json')).toBe('My Project');
  });

  it('leaves a name with no recognised extension untouched', () => {
    expect(stripProjectExtension('My Project')).toBe('My Project');
  });
});
