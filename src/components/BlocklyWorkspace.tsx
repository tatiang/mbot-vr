import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as EnMessages from 'blockly/msg/en';
import { defineMbotBlocks } from '../blocks/defineBlocks';
import { installGenerators } from '../blocks/generators';
import { TOOLBOX } from '../blocks/toolbox';

// Blockly ships its English strings as a separate module; without this the
// built-in logic/math blocks render as raw message keys.
Blockly.setLocale(EnMessages as unknown as Record<string, string>);

export interface BlocklyHandle {
  getWorkspace: () => Blockly.WorkspaceSvg | null;
  serialize: () => object;
  /**
   * Loads a serialized workspace. Returns `false` (leaving the workspace
   * empty rather than half-loaded) when `state` references block types or
   * fields this build no longer has - most often a project saved under an
   * older version of the app's block set. The caller decides what to show
   * the student; see App.tsx's `applyProjectFile`.
   */
  load: (state: object) => boolean;
  highlight: (blockId: string | null) => void;
  undo: () => void;
  redo: () => void;
  resize: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface Props {
  /** Fires on any change the student made (not on programmatic loads). */
  onChange?: () => void;
  /** Fires whenever the undo/redo stacks change depth. */
  onHistoryChange?: () => void;
  /**
   * Fires once the workspace exists and can accept a `load`. Restoring content
   * from here rather than from a parent effect is what keeps the initial
   * program alive through React StrictMode's mount / unmount / remount cycle,
   * which otherwise disposes the workspace right after it was populated.
   */
  onReady?: () => void;
  hidden?: boolean;
}

/**
 * Hosts the Blockly workspace.
 *
 * Blockly manages its own DOM, so React's only jobs here are to create the
 * injection div once, keep it sized, and expose an imperative handle. Anything
 * that re-injected the workspace on re-render would throw away the student's
 * scroll position and undo history.
 */
export const BlocklyWorkspace = forwardRef<BlocklyHandle, Props>(function BlocklyWorkspace(
  { onChange, onHistoryChange, onReady, hidden = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const highlightedRef = useRef<string | null>(null);
  // Set while we load a saved workspace, so the load itself is not reported as
  // a student edit (which would immediately mark a freshly opened file dirty).
  const loadingRef = useRef(false);

  const onChangeRef = useRef(onChange);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onReadyRef = useRef(onReady);
  onChangeRef.current = onChange;
  onHistoryChangeRef.current = onHistoryChange;
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    defineMbotBlocks();
    installGenerators();

    const workspace = Blockly.inject(host, {
      toolbox: TOOLBOX,
      // Zelos draws chunky, rounded, Scratch-like blocks - the shape language
      // this age group already knows from Scratch and mBlock.
      renderer: 'zelos',
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      trashcan: true,
      sounds: false,
      grid: { spacing: 24, length: 3, colour: '#dde4ef', snap: false },
      zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 2 },
      move: { scrollbars: true, drag: true, wheel: true },
      toolboxPosition: 'start',
    });

    workspaceRef.current = workspace;

    const listener = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      onHistoryChangeRef.current?.();
      if (loadingRef.current) return;
      onChangeRef.current?.();
    };
    workspace.addChangeListener(listener);

    // Blockly needs an explicit resize whenever its container changes size.
    const observer = new ResizeObserver(() => {
      Blockly.svgResize(workspace);
    });
    observer.observe(host);

    onReadyRef.current?.();

    return () => {
      observer.disconnect();
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  // Re-measure when the pane is revealed: Blockly cannot size itself while its
  // container is hidden.
  useEffect(() => {
    if (hidden) return;
    const workspace = workspaceRef.current;
    if (workspace) {
      // A frame's delay lets the layout settle before Blockly measures it.
      requestAnimationFrame(() => Blockly.svgResize(workspace));
    }
  }, [hidden]);

  const highlight = useCallback((blockId: string | null) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (highlightedRef.current === blockId) return;
    if (highlightedRef.current) workspace.highlightBlock(null);
    highlightedRef.current = blockId;
    if (blockId) {
      // The block may have been deleted mid-run; highlightBlock tolerates that
      // but guard anyway to keep the console clean.
      if (workspace.getBlockById(blockId)) workspace.highlightBlock(blockId);
    }
  }, []);

  useImperativeHandle(
    ref,
    (): BlocklyHandle => ({
      getWorkspace: () => workspaceRef.current,
      serialize: () => {
        const workspace = workspaceRef.current;
        return workspace ? Blockly.serialization.workspaces.save(workspace) : {};
      },
      load: (state: object) => {
        const workspace = workspaceRef.current;
        if (!workspace) return false;
        loadingRef.current = true;
        let ok = true;
        try {
          // Events stay off for the whole load. Blockly queues change events
          // and flushes them on a later task, so a plain synchronous flag would
          // already be cleared by the time they arrived - and every freshly
          // opened project would look edited.
          Blockly.Events.disable();
          // Loading replaces the workspace wholesale; clearing first avoids
          // leaving orphaned blocks from the previous project behind.
          workspace.clear();
          try {
            Blockly.serialization.workspaces.load(state, workspace);
          } catch (error) {
            // A saved project can reference a block type, or a field on a
            // block, that this build no longer has - most often because the
            // block set changed between app versions. Blockly throws rather
            // than degrading gracefully in that case, and an uncaught error
            // here happens inside App.tsx's onReady effect, with nothing to
            // catch it - left unhandled, it blanks the whole page rather than
            // just failing to open one project. Catching it here, leaving the
            // workspace empty, and reporting failure to the caller is what
            // keeps "one old save" from taking the app down; see
            // App.tsx's `applyProjectFile`, which decides what the student
            // sees.
            console.error('[mBot VR] could not load a saved workspace:', error);
            ok = false;
            workspace.clear();
          }
        } finally {
          Blockly.Events.enable();
          workspace.clearUndo();
          // Belt and braces: anything Blockly still manages to queue during
          // this task is ignored too.
          setTimeout(() => {
            loadingRef.current = false;
            onHistoryChangeRef.current?.();
          }, 0);
        }
        return ok;
      },
      highlight,
      undo: () => workspaceRef.current?.undo(false),
      redo: () => workspaceRef.current?.undo(true),
      resize: () => {
        const workspace = workspaceRef.current;
        if (workspace) Blockly.svgResize(workspace);
      },
      canUndo: () => (workspaceRef.current?.getUndoStack().length ?? 0) > 0,
      canRedo: () => (workspaceRef.current?.getRedoStack().length ?? 0) > 0,
    }),
    [highlight],
  );

  return (
    <div
      ref={hostRef}
      className={`blockly-host${hidden ? ' blockly-host--hidden' : ''}`}
      // Blockly renders its own accessible tree; the container is decorative.
      aria-label="Block programming workspace"
      role="application"
    />
  );
});
