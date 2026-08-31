/**
 * Minimal ambient types for the File System Access API.
 *
 * TypeScript's bundled DOM lib does not (yet) ship these - they are a W3C
 * Community Group draft, not a finished standard - so this declares only the
 * handful of members `src/storage/nativeSave.ts` actually calls, rather than
 * pulling in a third-party `@types` package for a few methods. Chromium
 * browsers (Chrome, Edge) implement this; Safari and Firefox do not, which is
 * why every call site feature-detects with `'showSaveFilePicker' in window`
 * before touching any of it.
 */

interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
