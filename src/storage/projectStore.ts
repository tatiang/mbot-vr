import type { Arena, ProjectFile, ProjectSettings } from '../types';
import { makeId } from '../utils/id';
import { PHYSICS } from '../simulation/RobotPhysics';

/**
 * Local project storage.
 *
 * localStorage rather than IndexedDB: projects are a few kilobytes of JSON, the
 * synchronous API keeps the save path trivial, and it survives a browser
 * refresh on a shared Chromebook, which is the case that actually matters.
 */

export const PROJECT_VERSION = '1.0.0';

const INDEX_KEY = 'mbotvr.projects.v1';
const AUTOSAVE_KEY = 'mbotvr.autosave.v1';

export interface ProjectSummary {
  id: string;
  name: string;
  playground: string;
  savedAt: string;
}

interface StoredProject extends ProjectSummary {
  file: ProjectFile;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  showDistanceSensor: true,
  showLineSensors: true,
  showGrid: true,
  speed: 1,
  highlightBlocks: true,
  opponentEnabled: false,
  robotMassKg: PHYSICS.defaultMassKg,
  opponentMassKg: PHYSICS.defaultMassKg,
};

/**
 * Upgrades settings saved by an older build.
 *
 * v1.0 had a single `showSensorOverlay` flag covering both overlays; it is now
 * split into a distance-sensor and a line-sensor toggle. An old project should
 * reopen looking the way the student left it, so the old flag seeds both.
 */
function migrateSettings(raw: Record<string, unknown>): Partial<ProjectSettings> {
  const migrated: Partial<ProjectSettings> = { ...(raw as Partial<ProjectSettings>) };
  if (typeof raw.showSensorOverlay === 'boolean') {
    if (raw.showDistanceSensor === undefined) migrated.showDistanceSensor = raw.showSensorOverlay;
    if (raw.showLineSensors === undefined) migrated.showLineSensors = raw.showSensorOverlay;
  }
  return migrated;
}

function readIndex(): StoredProject[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredProject[]) : [];
  } catch {
    // Corrupt or unavailable storage should never take the app down; a student
    // losing one save is far better than a blank screen.
    return [];
  }
}

function writeIndex(projects: StoredProject[]): boolean {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): ProjectSummary[] {
  return readIndex()
    .map(({ id, name, playground, savedAt }) => ({ id, name, playground, savedAt }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function loadProject(id: string): ProjectFile | null {
  const found = readIndex().find((p) => p.id === id);
  return found ? found.file : null;
}

/**
 * Saves under an existing id, or creates a new entry.
 * Returns the id used, or null when storage refused the write.
 */
export function saveProject(file: ProjectFile, id?: string): string | null {
  const projects = readIndex();
  const projectId = id ?? makeId('proj');
  const entry: StoredProject = {
    id: projectId,
    name: file.name,
    playground: file.playground,
    savedAt: file.savedAt,
    file,
  };

  const existingIndex = projects.findIndex((p) => p.id === projectId);
  if (existingIndex >= 0) projects[existingIndex] = entry;
  else projects.push(entry);

  return writeIndex(projects) ? projectId : null;
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((p) => p.id !== id));
}

export function buildProjectFile(input: {
  name: string;
  playground: string;
  blockWorkspace: unknown;
  customArena: Arena | null;
  settings: ProjectSettings;
}): ProjectFile {
  return {
    version: PROJECT_VERSION,
    name: input.name,
    playground: input.playground,
    blockWorkspace: input.blockWorkspace,
    customArena: input.customArena,
    settings: input.settings,
    savedAt: new Date().toISOString(),
  };
}

// --- autosave --------------------------------------------------------------

/**
 * Snapshot of the current work, rewritten as the student edits. This is what
 * makes an accidental browser refresh survivable.
 */
export function writeAutosave(file: ProjectFile): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
  } catch {
    // Out of quota or private mode - autosave is best-effort by design.
  }
}

export function readAutosave(): ProjectFile | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as ProjectFile) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Nothing to do.
  }
}

// --- import / export -------------------------------------------------------

export function exportProjectJson(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

export class ProjectImportError extends Error {}

/**
 * Parses an exported project, checking enough structure that a wrong file
 * produces a clear message instead of a broken workspace.
 */
export function parseProjectJson(text: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectImportError("That file isn't a project file - it isn't valid JSON.");
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ProjectImportError("That file isn't an mBot VR project.");
  }

  const candidate = parsed as Partial<ProjectFile>;
  if (typeof candidate.name !== 'string' || typeof candidate.playground !== 'string') {
    throw new ProjectImportError(
      "That file isn't an mBot VR project - it's missing a name or a playground.",
    );
  }
  if (candidate.blockWorkspace === undefined) {
    throw new ProjectImportError('That project file has no blocks in it.');
  }

  return {
    version: typeof candidate.version === 'string' ? candidate.version : PROJECT_VERSION,
    name: candidate.name,
    playground: candidate.playground,
    blockWorkspace: candidate.blockWorkspace,
    customArena: (candidate.customArena as Arena | null) ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...migrateSettings((candidate.settings ?? {}) as Record<string, unknown>),
    },
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date().toISOString(),
  };
}

/** Triggers a browser download of the project JSON. */
export function downloadProject(file: ProjectFile): void {
  const blob = new Blob([exportProjectJson(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeFilename(file.name)}.mbotvr.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking on the next tick gives Safari time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A project's display name, made safe for use as a filename. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-z0-9\-_ ]/gi, '').trim();
  return cleaned.length ? cleaned.replace(/\s+/g, '-') : 'mbot-vr-project';
}
