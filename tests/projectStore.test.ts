import { beforeEach, describe, expect, it } from 'vitest';

/** Minimal localStorage stand-in so the store can be tested under Node. */
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

const {
  buildProjectFile,
  clearAutosave,
  deleteProject,
  exportProjectJson,
  listProjects,
  loadProject,
  parseProjectJson,
  ProjectImportError,
  readAutosave,
  saveProject,
  writeAutosave,
  DEFAULT_SETTINGS,
  PROJECT_VERSION,
} = await import('../src/storage/projectStore');

function sampleFile(name = 'Test program') {
  return buildProjectFile({
    name,
    playground: 'grid',
    blockWorkspace: { blocks: { languageVersion: 0, blocks: [{ type: 'mbot_when_start' }] } },
    customArena: null,
    settings: DEFAULT_SETTINGS,
  });
}

beforeEach(() => storage.clear());

describe('project serialization', () => {
  it('round-trips through export and import', () => {
    const file = sampleFile();
    const parsed = parseProjectJson(exportProjectJson(file));
    expect(parsed).toEqual(file);
  });

  it('stamps the current version and a save time', () => {
    const file = sampleFile();
    expect(file.version).toBe(PROJECT_VERSION);
    expect(Number.isNaN(Date.parse(file.savedAt))).toBe(false);
  });

  it('rejects files that are not JSON', () => {
    expect(() => parseProjectJson('not json at all')).toThrow(ProjectImportError);
  });

  it('rejects JSON that is not a project', () => {
    expect(() => parseProjectJson('{"hello":"world"}')).toThrow(ProjectImportError);
    expect(() => parseProjectJson('[1,2,3]')).toThrow(ProjectImportError);
  });

  it('rejects a project with no blocks', () => {
    expect(() => parseProjectJson('{"name":"a","playground":"grid"}')).toThrow(ProjectImportError);
  });

  it('fills in missing settings with the defaults', () => {
    const parsed = parseProjectJson(
      JSON.stringify({ name: 'x', playground: 'grid', blockWorkspace: {}, settings: { speed: 2 } }),
    );
    expect(parsed.settings.speed).toBe(2);
    expect(parsed.settings.showDistanceSensor).toBe(DEFAULT_SETTINGS.showDistanceSensor);
    expect(parsed.settings.robotMassKg).toBe(DEFAULT_SETTINGS.robotMassKg);
  });

  it('upgrades the old single sensor-overlay flag into the two new toggles', () => {
    // v1.0 projects had one `showSensorOverlay`; a project saved with the
    // overlay hidden must still reopen with both overlays hidden.
    const parsed = parseProjectJson(
      JSON.stringify({
        name: 'x',
        playground: 'grid',
        blockWorkspace: {},
        settings: { showSensorOverlay: false },
      }),
    );
    expect(parsed.settings.showDistanceSensor).toBe(false);
    expect(parsed.settings.showLineSensors).toBe(false);
  });

  it('prefers an explicit new toggle over the migrated old one', () => {
    const parsed = parseProjectJson(
      JSON.stringify({
        name: 'x',
        playground: 'grid',
        blockWorkspace: {},
        settings: { showSensorOverlay: false, showDistanceSensor: true },
      }),
    );
    expect(parsed.settings.showDistanceSensor).toBe(true);
    expect(parsed.settings.showLineSensors).toBe(false);
  });
});

describe('project storage', () => {
  it('saves, lists, loads and deletes', () => {
    const id = saveProject(sampleFile('First'));
    expect(id).not.toBeNull();

    const listed = listProjects();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('First');

    expect(loadProject(id!)?.name).toBe('First');

    deleteProject(id!);
    expect(listProjects()).toHaveLength(0);
    expect(loadProject(id!)).toBeNull();
  });

  it('overwrites when saving under an existing id', () => {
    const id = saveProject(sampleFile('Original'))!;
    saveProject(sampleFile('Renamed'), id);
    expect(listProjects()).toHaveLength(1);
    expect(loadProject(id)?.name).toBe('Renamed');
  });

  it('creates a separate entry for Save As', () => {
    saveProject(sampleFile('One'));
    saveProject(sampleFile('Two'));
    expect(listProjects()).toHaveLength(2);
  });

  it('survives a corrupt index instead of throwing', () => {
    storage.setItem('mbotvr.projects.v1', '{{{ not json');
    expect(listProjects()).toEqual([]);
  });

  it('round-trips the autosave slot', () => {
    expect(readAutosave()).toBeNull();
    writeAutosave(sampleFile('Autosaved'));
    expect(readAutosave()?.name).toBe('Autosaved');
    clearAutosave();
    expect(readAutosave()).toBeNull();
  });
});
