import { useRef, useState } from 'react';
import type { ProjectFile } from '../types';
import {
  deleteProject,
  listProjects,
  loadProject,
  parseProjectJson,
  ProjectImportError,
  type ProjectSummary,
} from '../storage/projectStore';
import { STARTER_PROGRAMS } from '../blocks/starters';
import { DownloadIcon, TrashIcon, UploadIcon } from './icons';

interface Props {
  onOpen: (file: ProjectFile, id: string) => void;
  onImport: (file: ProjectFile) => void;
  onLoadStarter: (starterId: string) => void;
  onExport: () => void;
  onMessage: (kind: 'info' | 'error' | 'success', text: string) => void;
}

/**
 * Saved projects, example programs, and import/export.
 *
 * There are no accounts and no server: everything lives in this browser, and
 * Export produces a JSON file a student can hand in or carry to another
 * machine.
 */
export function ProjectManager({ onOpen, onImport, onLoadStarter, onExport, onMessage }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>(() => listProjects());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setProjects(listProjects());

  const handleOpen = (summary: ProjectSummary) => {
    const file = loadProject(summary.id);
    if (!file) {
      onMessage('error', 'That project could not be opened. It may have been removed.');
      refresh();
      return;
    }
    onOpen(file, summary.id);
  };

  const handleDelete = (summary: ProjectSummary) => {
    deleteProject(summary.id);
    refresh();
    onMessage('info', `Deleted "${summary.name}".`);
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      onImport(parseProjectJson(text));
    } catch (error) {
      onMessage(
        'error',
        error instanceof ProjectImportError
          ? error.message
          : 'That file could not be read. Try exporting it again.',
      );
    }
  };

  return (
    <div>
      <div className="tools">
        <button type="button" className="btn btn--sm" onClick={onExport}>
          <DownloadIcon size={15} /> Export current project
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon size={15} /> Import from file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            // Reset so re-importing the same file fires a change event again.
            event.target.value = '';
          }}
        />
      </div>

      <div className="prose" style={{ paddingBottom: 0 }}>
        <h3>Saved on this computer</h3>
      </div>
      {projects.length === 0 ? (
        <p className="list__empty">
          No saved projects yet. Use <strong>Save</strong> in the header to keep your work.
        </p>
      ) : (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id} className="list__item">
              <div className="list__item-main">
                <div className="list__item-name">{project.name}</div>
                <div className="list__item-meta">
                  {project.playground} &middot; {formatDate(project.savedAt)}
                </div>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => handleOpen(project)}>
                Open
              </button>
              <button
                type="button"
                className="btn btn--sm btn--icon"
                aria-label={`Delete ${project.name}`}
                onClick={() => handleDelete(project)}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="prose" style={{ paddingBottom: 0 }}>
        <h3>Example programs</h3>
        <p>Loading an example replaces the blocks in your workspace.</p>
      </div>
      <ul className="list">
        {STARTER_PROGRAMS.map((starter) => (
          <li key={starter.id} className="list__item">
            <div className="list__item-main">
              <div className="list__item-name">{starter.name}</div>
              <div className="list__item-meta">{starter.description}</div>
            </div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onLoadStarter(starter.id)}
            >
              Load
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
