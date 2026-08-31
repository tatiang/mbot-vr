import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { clearAutosave } from '../storage/projectStore';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort safety net around the whole app.
 *
 * Nothing here is supposed to throw during render - failures that are
 * anticipated (a Blockly workspace referencing blocks this build no longer
 * has, corrupt localStorage JSON, ...) are already caught close to their
 * source; see BlocklyWorkspace's `load` and App.tsx's `applyProjectFile`.
 * This exists for whatever slips past that: without it, any uncaught render
 * or effect error unmounts the tree and leaves a blank white page with
 * nothing telling the student (or the teacher standing over their shoulder)
 * what happened or what to do about it - which is close to the worst
 * possible failure mode for a classroom tool.
 *
 * Deliberately styled inline rather than with the app's CSS classes: the
 * point of this component is to render something useful even if an
 * assumption elsewhere in the app's state turned out to be wrong.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[mBot VR] unexpected error:', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  private clearAndReload = (): void => {
    // The most common real-world cause of a crash this boundary actually
    // catches is a saved workspace from an older version of the block set -
    // clearing the autosave is what gives a stuck page a way out.
    clearAutosave();
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h1 style={headingStyle}>mBot VR ran into a problem</h1>
          <p style={textStyle}>
            Something unexpected happened and the page could not keep running. Reloading fixes
            this most of the time.
          </p>
          <p style={textStyle}>
            If it keeps happening, this browser may have a saved project from an older version of
            mBot VR that this version cannot read. Clearing it will lose that one autosave, but
            nothing else.
          </p>
          <div style={buttonRowStyle}>
            <button type="button" onClick={this.reload} style={buttonStyle(true)}>
              Reload
            </button>
            <button type="button" onClick={this.clearAndReload} style={buttonStyle(false)}>
              Clear saved data and reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: 24,
  background: '#eef1f7',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  maxWidth: 480,
  padding: '28px 32px',
  borderRadius: 14,
  background: '#ffffff',
  boxShadow: '0 12px 34px rgba(16, 24, 40, 0.16)',
  textAlign: 'center',
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 19,
  fontWeight: 700,
  color: '#16202e',
};

const textStyle: CSSProperties = {
  margin: 0,
  fontSize: 14.5,
  lineHeight: 1.5,
  color: '#46536a',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 6,
  flexWrap: 'wrap',
  justifyContent: 'center',
};

function buttonStyle(primary: boolean): CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 10,
    border: primary ? 'none' : '1px solid #c3ccdb',
    background: primary ? '#1f5fbf' : '#ffffff',
    color: primary ? '#ffffff' : '#16202e',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  };
}
