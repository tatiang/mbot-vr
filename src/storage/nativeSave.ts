import type { ProjectFile } from '../types';
import { exportProjectJson, sanitizeFilename } from './projectStore';

/**
 * Real file saving via the File System Access API.
 *
 * This is what lets "Save" and "Save As" put up an actual operating-system
 * save dialog (a native macOS/Windows picker, not anything drawn by the
 * page) and write a real file to disk that the student can find in Finder or
 * Explorer - something a browser cannot otherwise do without a backend.
 *
 * Only Chromium browsers (Chrome, Edge) support this today; Safari and
 * Firefox do not. `isNativeSaveSupported` is the feature-detection gate every
 * caller checks first, and App.tsx falls back to the existing download-based
 * Export when it is false, so Save/Save As still do something useful there -
 * they just cannot offer a real dialog.
 */
export function isNativeSaveSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

export type NativeSaveOutcome =
  | { status: 'saved'; handle: FileSystemFileHandle }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/**
 * Writes `file` to disk.
 *
 * Pass an existing `handle` to overwrite that same file silently - this is
 * what makes a second "Save" behave like a real desktop app's Save (write to
 * the already-known file) rather than asking again. Omit it, or pass `null`,
 * to always prompt for a location - used for the first Save on a project and
 * for Save As.
 */
export async function saveProjectToDisk(
  file: ProjectFile,
  handle: FileSystemFileHandle | null,
): Promise<NativeSaveOutcome> {
  try {
    let target = handle;
    if (!target) {
      if (!window.showSaveFilePicker) {
        return { status: 'error', message: 'not supported' };
      }
      target = await window.showSaveFilePicker({
        suggestedName: `${sanitizeFilename(file.name)}.mbotvr.json`,
        types: [
          {
            description: 'mBot VR Project',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
    }

    const writable = await target.createWritable();
    await writable.write(exportProjectJson(file));
    await writable.close();
    return { status: 'saved', handle: target };
  } catch (error) {
    // The user closing the dialog without picking a location throws
    // AbortError - that is a cancel, not a failure, and should not produce an
    // error toast.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'cancelled' };
    }
    console.error('[mBot VR] could not save the file:', error);
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Strips the extension this app saves with, for redisplaying a chosen filename. */
export function stripProjectExtension(filename: string): string {
  return filename.replace(/\.mbotvr\.json$/i, '').replace(/\.json$/i, '');
}
