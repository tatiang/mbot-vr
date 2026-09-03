import type { Arena } from '../types';
import { FolderIcon, HelpIcon, OpponentRobotIcon, SaveIcon } from './icons';

interface Props {
  playgrounds: Arena[];
  playgroundId: string;
  onPlaygroundChange: (id: string) => void;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  dirty: boolean;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenProjects: () => void;
  onOpenHelp: () => void;
}

/** Application header: identity, playground picker, and project actions. */
export function Toolbar({
  playgrounds,
  playgroundId,
  onPlaygroundChange,
  projectName,
  onProjectNameChange,
  dirty,
  onNew,
  onSave,
  onSaveAs,
  onOpenProjects,
  onOpenHelp,
}: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <OpponentRobotIcon size={19} />
        </span>
        mBot VR
        <span className="brand__version">v1.3</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="playground-select">
          Playground
        </label>
        <select
          id="playground-select"
          className="select"
          value={playgroundId}
          onChange={(event) => onPlaygroundChange(event.target.value)}
        >
          {playgrounds.map((playground) => (
            <option key={playground.id} value={playground.id}>
              {playground.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="project-name">
          Project
        </label>
        <input
          id="project-name"
          className="text-input"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          aria-describedby={dirty ? 'unsaved-hint' : undefined}
        />
        {dirty && (
          <span id="unsaved-hint" className="field__label" style={{ color: '#fff', fontWeight: 700 }}>
            ● Unsaved
          </span>
        )}
      </div>

      <div className="header__spacer" />

      <button type="button" className="btn btn--sm" onClick={onNew}>
        New
      </button>
      <button
        type="button"
        className="btn btn--sm"
        onClick={onSave}
        title="Save (Ctrl/Cmd+S). In Chrome or Edge, this opens a real save dialog."
      >
        <SaveIcon size={15} /> Save
      </button>
      <button
        type="button"
        className="btn btn--sm"
        onClick={onSaveAs}
        title="Save a copy to a new file, choosing the location."
      >
        Save As
      </button>
      <button type="button" className="btn btn--sm" onClick={onOpenProjects}>
        <FolderIcon size={15} /> Open
      </button>
      <button
        type="button"
        className="btn btn--sm btn--icon"
        onClick={onOpenHelp}
        aria-label="Help and block reference"
        title="Help and block reference"
      >
        <HelpIcon size={17} />
      </button>
    </header>
  );
}
