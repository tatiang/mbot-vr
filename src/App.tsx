import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Arena, ProjectFile, ProjectSettings, RunState } from './types';
import { isHardwareFeatureEnabled } from './device/featureFlag';
import { DiagnosticLog } from './diagnostics/DiagnosticLog';
import { SimulationEngine } from './simulation/SimulationEngine';
import { ProgramRunner } from './runtime/ProgramRunner';
import { createEngineRuntime } from './runtime/RobotRuntimeBridge';
import { compileWorkspace, previewJavaScript } from './blocks/compile';
import { EMPTY_WORKSPACE, starterById } from './blocks/starters';
import { PLAYGROUNDS, cloneArena, getPlayground, DEFAULT_PLAYGROUND_ID } from './playgrounds';
import { pickDefaultOpponentSpot } from './simulation/opponentPlacement';
import { clampMass } from './simulation/RobotPhysics';
import {
  DEFAULT_SETTINGS,
  buildProjectFile,
  clearAutosave,
  downloadProject,
  readAutosave,
  saveProject,
  writeAutosave,
} from './storage/projectStore';
import { isNativeSaveSupported, saveProjectToDisk, stripProjectExtension } from './storage/nativeSave';

import { Toolbar } from './components/Toolbar';
import { RunBar } from './components/RunBar';
import { BlocklyWorkspace, type BlocklyHandle } from './components/BlocklyWorkspace';
import { SimulatorCanvas, type EditorTool } from './components/SimulatorCanvas';
import { SensorMonitor } from './components/SensorMonitor';
import { ChallengePanel } from './components/ChallengePanel';
import { HelpPanel } from './components/HelpPanel';
import { ProjectManager } from './components/ProjectManager';
import { ArenaEditor } from './components/ArenaEditor';
import { RobotSetup } from './components/RobotSetup';
import { SplitPane } from './components/SplitPane';
import { CodeView } from './components/CodeView';
import {
  Collapsible,
  Drawer,
  ToastHost,
  ToggleButton,
  type ToastKind,
  type ToastMessage,
} from './components/ui';
import { useEngineSample } from './hooks/useEngineSample';
import { RedoIcon, UndoIcon, OpponentRobotIcon } from './components/icons';

type Tab = 'blocks' | 'javascript';
type StackedPane = 'left' | 'right' | 'both';

const NEW_PROJECT_NAME = 'My mBot program';
/** Matches the badge in Toolbar.tsx. Duplicated rather than imported from package.json
 *  so the build does not need a module outside src/ - see src/device/featureFlag.ts
 *  for the flag this version number is logged alongside. */
const APP_VERSION = '1.3.0';

/**
 * The physical-robot feature, loaded when `isHardwareFeatureEnabled()` allows it.
 * The default is now on; an explicit `?hardware=0` opt-out still means "never
 * downloaded" - Vite code-splits this and everything it imports from `src/device/*`
 * into a separate chunk that an opted-out simulator-only session never requests.
 */
const DeviceSection = lazy(() => import('./components/DeviceSection').then((m) => ({ default: m.DeviceSection })));

export default function App() {
  // --- one-time engine + runner setup --------------------------------------
  //
  // Both live for the lifetime of the app. The engine owns the animation loop;
  // the runner owns the program worker.
  const [engine] = useState(() => new SimulationEngine(cloneArena(getPlayground(DEFAULT_PLAYGROUND_ID))));
  const workspaceRef = useRef<BlocklyHandle>(null);

  const [runState, setRunState] = useState<RunState>('idle');
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [playgroundId, setPlaygroundId] = useState(DEFAULT_PLAYGROUND_ID);
  const [arena, setArena] = useState<Arena>(() => cloneArena(getPlayground(DEFAULT_PLAYGROUND_ID)));

  const [projectName, setProjectName] = useState(NEW_PROJECT_NAME);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [tab, setTab] = useState<Tab>('blocks');
  const [previewCode, setPreviewCode] = useState('');
  const [stacked, setStacked] = useState<StackedPane>('both');
  const [narrow, setNarrow] = useState(false);

  const [tool, setTool] = useState<EditorTool>('select');
  const [snap, setSnap] = useState(true);
  /**
   * True once the student has changed anything about the arena - obstacles,
   * tape, or either robot's start pose. Built-in playgrounds are only saved
   * into the project file when this is set, so an untouched playground keeps
   * tracking its definition in the code rather than freezing a stale copy.
   */
  const [arenaModified, setArenaModified] = useState(false);

  const [helpOpen, setHelpOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  // --- physical robot (see docs/hardware-bridge-plan.md) -------------------
  //
  // The diagnostic log is created unconditionally - it is useful even with no robot
  // ever attached, and it is the on-by-default part of the feature (see §15's phase
  // table). `DeviceSection` itself is the part gated by the flag and lazy-loaded.
  const [diagnosticLog] = useState(() => new DiagnosticLog(APP_VERSION));
  const [hardwareEnabled] = useState(isHardwareFeatureEnabled);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const toastSeq = useRef(0);
  const announcedRestoreRef = useRef(false);

  const pushToast = useCallback((kind: ToastKind, text: string) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((current) => [...current.slice(-2), { id, kind, text }]);
    // Errors linger a little longer; nothing here is important enough to block.
    const ttl = kind === 'error' ? 8000 : 4200;
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), ttl);
  }, []);

  const dismissToast = useCallback(
    (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    [],
  );

  // --- program runner ------------------------------------------------------

  const runnerRef = useRef<ProgramRunner | null>(null);
  if (runnerRef.current === null) {
    runnerRef.current = new ProgramRunner(createEngineRuntime(engine), {
      onHighlight: (blockId) => workspaceRef.current?.highlight(blockId),
      onFinished: () => {
        // A finished program leaves the motors as it set them, like real
        // hardware does.
        engine.endProgram(false);
        setRunState('idle');
        if (engine.coasting) {
          pushToast(
            'info',
            'Your program finished, but the motors are still running. Add a "stop moving" block at the end, or press Stop.',
          );
        }
      },
      onError: (message, detail) => {
        // A crashed program is not in control of anything; cut the motors.
        engine.endProgram(true);
        setRunState('idle');
        pushToast('error', message);
        // Developers still get the real thing.
        console.error('[mBot VR] program error:', detail);
      },
    });
  }

  useEffect(() => {
    engine.start();
    const runner = runnerRef.current;

    // Development-only inspection hook. Handy when debugging a playground or
    // demonstrating the physics from the console; stripped from production
    // builds, so it is never part of the shipped API surface.
    if (import.meta.env.DEV) {
      (window as unknown as { __mbotVR?: unknown }).__mbotVR = { engine, runner };
    }

    return () => {
      runner?.dispose();
      engine.dispose();
      if (import.meta.env.DEV) {
        delete (window as unknown as { __mbotVR?: unknown }).__mbotVR;
      }
    };
  }, [engine]);

  // --- keep the engine in step with UI state -------------------------------

  useEffect(() => {
    engine.speed = settings.speed;
  }, [engine, settings.speed]);

  /**
   * True when the pending arena change is only a start-pose edit, so the
   * engine should leave both robots exactly where they are instead of
   * resetting them. Read and cleared by the effect below.
   */
  const preservePosesRef = useRef(false);

  useEffect(() => {
    engine.setArena(arena, { preservePoses: preservePosesRef.current });
    preservePosesRef.current = false;
  }, [engine, arena]);

  /**
   * Keeps the parked practice opponent in step with the "include opponent"
   * toggle and the current arena.
   *
   * Separate from the `setArena` effect above because that one resets the
   * student's robot; `setParkedOpponent` never touches it. Dragging the
   * opponent goes straight to the engine (see SimulatorCanvas) and only
   * commits an `opponentStart` on pointer-up, so this effect re-running mid-
   * drag cannot fight the pointer.
   *
   * Switching playground clears `opponentStart` along with the rest of the
   * arena, so a fresh clear spot is chosen - a position valid in one
   * playground's geometry can sit inside a wall in another's.
   */
  useEffect(() => {
    if (arena.id === 'battle') return; // that arena scripts its own opponent
    if (!settings.opponentEnabled) {
      engine.setParkedOpponent(null);
      return;
    }
    if (arena.opponentStart) {
      engine.setParkedOpponent(arena.opponentStart);
      return;
    }
    // First time in this arena: pick a clear spot, and record it as the
    // opponent's start so Reset returns it there after it has been shoved
    // around. Writing it back re-runs this effect once, which then takes the
    // branch above - it cannot loop.
    const spot = pickDefaultOpponentSpot(arena);
    engine.setParkedOpponent(spot);
    preservePosesRef.current = true;
    setArena((current) => ({ ...current, opponentStart: spot }));
  }, [engine, arena, settings.opponentEnabled]);

  // Masses are applied after the opponent exists, so a freshly placed one
  // picks up the configured weight rather than the default.
  useEffect(() => {
    engine.setMasses(settings.robotMassKg, settings.opponentMassKg);
  }, [engine, settings.robotMassKg, settings.opponentMassKg, settings.opponentEnabled, arena]);

  // --- responsive layout ---------------------------------------------------

  useEffect(() => {
    const query = window.matchMedia('(max-width: 980px)');
    const apply = () => {
      setNarrow(query.matches);
      setStacked(query.matches ? 'left' : 'both');
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // --- autosave and refresh protection -------------------------------------

  const currentFile = useCallback(
    (): ProjectFile =>
      buildProjectFile({
        name: projectName,
        playground: playgroundId,
        blockWorkspace: workspaceRef.current?.serialize() ?? {},
        customArena: arena.editable || arenaModified ? arena : null,
        settings,
      }),
    [projectName, playgroundId, arena, arenaModified, settings],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  // Autosave is debounced: Blockly fires a change event per drag frame.
  useEffect(() => {
    if (!dirty) return undefined;
    const handle = setTimeout(() => writeAutosave(currentFile()), 900);
    return () => clearTimeout(handle);
  }, [dirty, currentFile, historyTick]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      // Browsers ignore custom text now, but returnValue is still what triggers
      // the built-in "leave site?" prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /**
   * Populates a freshly injected workspace. Called by BlocklyWorkspace once the
   * workspace exists, which is also the only moment it can be reliably loaded.
   */
  const handleWorkspaceReady = useCallback(() => {
    const autosaved = readAutosave();
    if (!autosaved) {
      // First visit: start from the empty program so the hat block is present.
      workspaceRef.current?.load(EMPTY_WORKSPACE);
      return;
    }
    const restored = applyProjectFile(autosaved, null, { silent: true });
    if (!restored) {
      // The autosave referenced blocks this build no longer has - almost
      // always because the block set changed in an update since it was
      // written. Clear it so the same broken autosave cannot keep failing on
      // every future refresh, and say plainly what happened rather than
      // silently starting empty.
      clearAutosave();
      if (!announcedRestoreRef.current) {
        announcedRestoreRef.current = true;
        pushToast(
          'error',
          "Your last saved program used an older version of mBot VR's blocks and could not be restored. Starting a new program.",
        );
      }
      return;
    }
    if (!announcedRestoreRef.current) {
      announcedRestoreRef.current = true;
      pushToast('info', 'Restored your last program from this browser.');
    }
    // applyProjectFile reads current state but is only ever called on a fresh
    // workspace, where that state is still the initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToast]);

  // --- project actions -----------------------------------------------------

  /**
   * Loads a project into the app. Returns `false` when the blocks could not
   * be restored (see BlocklyWorkspace's `load`) - the arena, name and
   * settings are still applied either way, since none of those depend on the
   * block set and there is no reason to lose them too.
   */
  function applyProjectFile(
    file: ProjectFile,
    id: string | null,
    options: { silent?: boolean } = {},
  ): boolean {
    const basePlayground = getPlayground(file.playground);
    // A saved arena is used whenever it belongs to this playground, so a moved
    // start pose or an edited course both come back.
    const saved = file.customArena;
    const useSaved = Boolean(saved) && saved!.id === basePlayground.id;
    const nextArena = useSaved ? saved! : cloneArena(basePlayground);

    setPlaygroundId(basePlayground.id);
    setArena(nextArena);
    setArenaModified(useSaved);
    setProjectName(file.name);
    setProjectId(id);
    setSettings({ ...DEFAULT_SETTINGS, ...file.settings });
    // Whatever file this project used to be saved to on disk (if any) belongs
    // to a different project now; the next Save must prompt for a location
    // again rather than silently overwriting it.
    fileHandleRef.current = null;
    const loaded = workspaceRef.current?.load((file.blockWorkspace as object) ?? EMPTY_WORKSPACE) ?? false;
    if (!loaded) workspaceRef.current?.load(EMPTY_WORKSPACE);
    setDirty(!loaded);

    if (!options.silent) {
      if (loaded) {
        pushToast('success', `Opened "${file.name}".`);
      } else {
        pushToast(
          'error',
          `"${file.name}" used an older version of mBot VR's blocks, so its blocks could not be restored. The playground and settings loaded normally - starting with an empty program.`,
        );
      }
    }
    return loaded;
  }

  const handleNew = () => {
    handleStop();
    workspaceRef.current?.load(EMPTY_WORKSPACE);
    setProjectName(NEW_PROJECT_NAME);
    setProjectId(null);
    fileHandleRef.current = null;
    setDirty(false);
    clearAutosave();
    engine.resetRobot();
    // The playground is deliberately left alone: a student who has built a
    // course in Free Build should not lose it by starting a new program.
    pushToast('info', 'Started a new program. Your playground is unchanged.');
  };

  /**
   * Handle to the real file on disk this project is saved to, once it has one
   * - either because the student used the native picker (see below) this
   * session, or is about to. `null` means "no known file yet": the next Save
   * behaves like Save As and prompts for a location, exactly like a fresh
   * document in a native app.
   */
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);

  /**
   * Save / Save As.
   *
   * `forceNew` (Save As) always prompts for a new location. Plain Save
   * reuses the file already on disk once one exists, and only prompts the
   * first time - the same distinction a native app's File menu makes.
   *
   * Where the File System Access API is available (Chrome, Edge) this puts
   * up a real operating-system save dialog and writes an actual file the
   * student can find in Finder or Explorer. Where it is not (Safari,
   * Firefox) this falls back to the existing browser download, so Save still
   * produces a file - just without a dialog to choose where.
   *
   * Either way, the project is also kept in this browser's local project
   * list and autosave slot, so Open and "restore my last program" keep
   * working exactly as before; the native file is an addition, not a
   * replacement.
   */
  const handleSave = async (forceNew = false) => {
    const file = currentFile();

    if (isNativeSaveSupported()) {
      const outcome = await saveProjectToDisk(file, forceNew ? null : fileHandleRef.current);
      if (outcome.status === 'cancelled') return; // closing the dialog is not an error
      if (outcome.status === 'error') {
        pushToast('error', 'The file could not be saved. Try Export instead.');
        return;
      }
      fileHandleRef.current = outcome.handle;
      // Reflect whatever the student actually named the file (or renamed it
      // to, in the dialog) back into the project name, the way a native
      // app's title bar tracks the file on disk.
      const diskName = stripProjectExtension(outcome.handle.name);
      if (diskName && diskName !== projectName) setProjectName(diskName);
    } else {
      downloadProject(file);
    }

    const savedId = saveProject(file, forceNew ? undefined : (projectId ?? undefined));
    if (savedId) setProjectId(savedId);
    setDirty(false);
    writeAutosave(file);
    pushToast(
      'success',
      isNativeSaveSupported()
        ? `Saved "${file.name}" to disk.`
        : `Downloaded "${file.name}". This browser cannot show a save dialog, so Save works like Export here.`,
    );
  };

  const handleExport = () => {
    downloadProject(currentFile());
    pushToast('success', 'Exported a copy of this project.');
  };

  const handleLoadStarter = (starterId: string) => {
    const starter = starterById(starterId);
    if (!starter) return;
    handleStop();
    workspaceRef.current?.load(starter.workspace as object);
    // Examples are written for a particular playground; switch to it so the
    // program actually has something to do.
    if (starter.playgroundId !== playgroundId) changePlayground(starter.playgroundId);
    else engine.resetRobot();
    setProjectName(starter.name);
    setProjectId(null);
    fileHandleRef.current = null;
    setDirty(true);
    setProjectsOpen(false);
    pushToast('success', `Loaded the "${starter.name}" example.`);
  };

  // --- playground ----------------------------------------------------------

  const changePlayground = (id: string) => {
    handleStop();
    const next = cloneArena(getPlayground(id));
    setPlaygroundId(id);
    setArena(next);
    setArenaModified(false);
    setTool('select');
    setDirty(true);
  };

  const handleArenaChange = (next: Arena) => {
    setArena(next);
    setArenaModified(true);
    setDirty(true);
  };

  /**
   * Records a robot's current pose as the one Reset will return it to.
   *
   * Called when a drag or rotate finishes. `preservePoses` stops the resulting
   * arena change from bouncing both robots back to their starts.
   */
  const handleStartPoseCommit = useCallback(
    (which: 'robot' | 'opponent') => {
      const pose =
        which === 'robot'
          ? { ...engine.robot.pose }
          : engine.opponent
            ? { ...engine.opponent.pose }
            : null;
      if (!pose) return;

      preservePosesRef.current = true;
      setArena((current) =>
        which === 'robot' ? { ...current, start: pose } : { ...current, opponentStart: pose },
      );
      setArenaModified(true);
      setDirty(true);
    },
    [engine],
  );

  /** Puts both robots back on the poses the playground shipped with. */
  const handleRestoreStartPoses = useCallback(() => {
    handleStop();
    const pristine = getPlayground(playgroundId);
    setArena((current) => {
      const next: Arena = { ...current, start: { ...pristine.start } };
      delete next.opponentStart;
      return next;
    });
    setArenaModified(true);
    setDirty(true);
    pushToast('info', 'Start positions restored.');
    // handleStop is stable for this purpose; playgroundId drives the pristine
    // lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playgroundId, pushToast]);

  // --- run / stop / reset --------------------------------------------------

  const handleRun = useCallback(() => {
    const workspace = workspaceRef.current?.getWorkspace();
    if (!workspace) return;

    let compiled;
    try {
      compiled = compileWorkspace(workspace, { highlight: settings.highlightBlocks });
    } catch (error) {
      console.error('[mBot VR] could not generate code:', error);
      pushToast('error', 'Those blocks could not be turned into a program. Try undoing your last change.');
      return;
    }

    if (!compiled.hasStart) {
      pushToast('info', 'Add a "when program starts" block from the Start category first.');
      return;
    }
    if (compiled.attachedBlocks === 0) {
      pushToast('info', 'Drag some blocks underneath "when program starts", then press Run.');
      return;
    }
    if (compiled.startBlockCount > 1) {
      // Running one stack and silently ignoring the rest is confusing, so say so.
      pushToast(
        'info',
        'There is more than one "when program starts" block. Only the first one runs.',
      );
    }

    engine.beginProgram();
    setRunState('running');
    runnerRef.current?.start(compiled.code);
  }, [engine, pushToast, settings.highlightBlocks]);

  const handleStop = useCallback(() => {
    runnerRef.current?.stop();
    // The Stop button always cuts the motors, whatever the program was doing.
    engine.endProgram(true);
    setRunState('idle');
    workspaceRef.current?.highlight(null);
  }, [engine]);

  const handleReset = useCallback(() => {
    handleStop();
    engine.resetRobot();
  }, [engine, handleStop]);

  // --- keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === 'Enter') {
        event.preventDefault();
        handleRun();
        return;
      }
      if (event.key === 'Escape' && (runState === 'running' || engine.coasting)) {
        event.preventDefault();
        handleStop();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
        return;
      }
      // Blockly installs its own undo/redo shortcuts, but only while its
      // workspace has focus; this makes them work from anywhere in the app.
      if (mod && event.key.toLowerCase() === 'z' && !isBlocklyFocused()) {
        event.preventDefault();
        if (event.shiftKey) workspaceRef.current?.redo();
        else workspaceRef.current?.undo();
        setHistoryTick((t) => t + 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // --- JavaScript preview --------------------------------------------------

  useEffect(() => {
    if (tab !== 'javascript') return;
    const workspace = workspaceRef.current?.getWorkspace();
    if (!workspace) return;
    try {
      setPreviewCode(previewJavaScript(workspace));
    } catch {
      setPreviewCode('// Some blocks could not be converted yet.\n');
    }
  }, [tab, historyTick, dirty]);

  // --- derived -------------------------------------------------------------

  /**
   * Sampled as a boolean, so this only re-renders the shell when the robot
   * actually starts or stops coasting - not ten times a second.
   */
  const coasting = useEngineSample(engine, (e) => e.coasting, 10);

  const statusText = useMemo(() => {
    if (runState === 'running') return 'Program running';
    if (coasting) return 'Finished - motors still running';
    return 'Ready';
  }, [runState, coasting]);

  // Either kind of second robot counts, so the Battle Bot Arena's own
  // opponent also gets a mass control.
  const hasOpponent = playgroundId === 'battle' || settings.opponentEnabled;

  const canUndo = workspaceRef.current?.canUndo() ?? false;
  const canRedo = workspaceRef.current?.canRedo() ?? false;
  const isEditableArena = Boolean(arena.editable);

  const handleWorkspaceChange = useCallback(() => {
    markDirty();
    setHistoryTick((t) => t + 1);
  }, [markDirty]);

  const handleHistoryChange = useCallback(() => setHistoryTick((t) => t + 1), []);

  const handleSplitResize = useCallback(() => workspaceRef.current?.resize(), []);

  return (
    <div className="app">
      <Toolbar
        playgrounds={PLAYGROUNDS}
        playgroundId={playgroundId}
        onPlaygroundChange={changePlayground}
        projectName={projectName}
        onProjectNameChange={(name) => {
          setProjectName(name);
          setDirty(true);
        }}
        dirty={dirty}
        onNew={handleNew}
        onSave={() => handleSave(false)}
        onSaveAs={() => handleSave(true)}
        onOpenProjects={() => setProjectsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* Hidden by CSS above the stacking breakpoint, but always rendered so the
          app grid keeps a stable set of rows. */}
      <div className="mobile-tabs" role="tablist" aria-label="Choose a panel">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={stacked === 'left'}
          onClick={() => setStacked('left')}
        >
          Blocks
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={stacked === 'right'}
          onClick={() => setStacked('right')}
        >
          Playground
        </button>
      </div>

      <div className="app__main">
        <SplitPane
          initialRatio={0.44}
          onResize={handleSplitResize}
          stackedVisible={narrow ? stacked : 'both'}
          left={
            <section className="panel" style={{ flex: '1 1 auto' }}>
              <div className="panel__header">
                <h2 className="panel__title">Block programming</h2>
                <div className="tabs" role="tablist" aria-label="Program view">
                  <button
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === 'blocks'}
                    onClick={() => setTab('blocks')}
                  >
                    Blocks
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === 'javascript'}
                    onClick={() => setTab('javascript')}
                  >
                    JavaScript
                  </button>
                </div>
                <div style={{ flex: '1 1 auto' }} />
                <button
                  type="button"
                  className="btn btn--sm btn--icon"
                  onClick={() => {
                    workspaceRef.current?.undo();
                    handleHistoryChange();
                  }}
                  disabled={!canUndo}
                  aria-label="Undo (Ctrl or Cmd + Z)"
                  title="Undo (Ctrl/Cmd + Z)"
                >
                  <UndoIcon size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--icon"
                  onClick={() => {
                    workspaceRef.current?.redo();
                    handleHistoryChange();
                  }}
                  disabled={!canRedo}
                  aria-label="Redo (Ctrl or Cmd + Shift + Z)"
                  title="Redo (Ctrl/Cmd + Shift + Z)"
                >
                  <RedoIcon size={16} />
                </button>
              </div>
              <div className="panel__body">
                <BlocklyWorkspace
                  ref={workspaceRef}
                  onChange={handleWorkspaceChange}
                  onHistoryChange={handleHistoryChange}
                  onReady={handleWorkspaceReady}
                  hidden={tab !== 'blocks'}
                />
                {tab === 'javascript' && <CodeView code={previewCode} />}
              </div>
            </section>
          }
          right={
            <section className="panel" style={{ flex: '1 1 auto' }}>
              <div className="panel__header">
                <h2 className="panel__title">Virtual playground</h2>
                <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{arena.name}</span>
                <div style={{ flex: '1 1 auto' }} />
                {playgroundId !== 'battle' && (
                  <ToggleButton
                    pressed={settings.opponentEnabled}
                    onToggle={() =>
                      setSettings((s) => ({ ...s, opponentEnabled: !s.opponentEnabled }))
                    }
                    title="Place a stationary mBot in the arena to practise the ultrasonic sensor on. Drag it anywhere when the program isn't running."
                  >
                    <OpponentRobotIcon size={15} /> Opponent
                  </ToggleButton>
                )}
              </div>
              {isEditableArena && (
                <ArenaEditor
                  arena={arena}
                  tool={tool}
                  snap={snap}
                  onToolChange={setTool}
                  onSnapChange={setSnap}
                  onArenaChange={handleArenaChange}
                />
              )}
              <div className="panel__body" style={{ display: 'flex', overflow: 'hidden' }}>
                <SimulatorCanvas
                  engine={engine}
                  showDistanceSensor={settings.showDistanceSensor}
                  showLineSensors={settings.showLineSensors}
                  showGrid={settings.showGrid}
                  tool={isEditableArena ? tool : null}
                  snapToGrid={snap}
                  programRunning={runState === 'running'}
                  onArenaChange={handleArenaChange}
                  onStartPoseCommit={handleStartPoseCommit}
                />
              </div>
            </section>
          }
        />

        <div className="rail">
          <Collapsible title="Sensor monitor" defaultOpen>
            <SensorMonitor engine={engine} />
          </Collapsible>

          <Collapsible title="Challenge" defaultOpen>
            <ChallengePanel engine={engine} playgroundId={playgroundId} />
          </Collapsible>

          {hardwareEnabled && (
            <Suspense fallback={<Collapsible title="My robot"><p className="hint-text">Loading…</p></Collapsible>}>
              <DeviceSection
                getWorkspace={() => workspaceRef.current?.getWorkspace() ?? null}
                onHighlight={(blockId) => workspaceRef.current?.highlight(blockId)}
                pushToast={pushToast}
                diagnosticLog={diagnosticLog}
                appVersion={APP_VERSION}
                refreshToken={historyTick}
              />
            </Suspense>
          )}

          <Collapsible title="Robot setup">
            <RobotSetup
              robotMassKg={settings.robotMassKg}
              opponentMassKg={settings.opponentMassKg}
              hasOpponent={hasOpponent}
              onRobotMassChange={(massKg) =>
                setSettings((s) => ({ ...s, robotMassKg: clampMass(massKg) }))
              }
              onOpponentMassChange={(massKg) =>
                setSettings((s) => ({ ...s, opponentMassKg: clampMass(massKg) }))
              }
              onRestoreStartPoses={handleRestoreStartPoses}
              disabled={runState === 'running'}
            />
          </Collapsible>

          <Collapsible title="About this playground">
            <p className="prose" style={{ margin: 0 }}>
              {arena.description}
            </p>
          </Collapsible>
        </div>
      </div>

      <RunBar
        runState={runState}
        canStop={runState === 'running' || coasting}
        onRun={handleRun}
        onStop={handleStop}
        onReset={handleReset}
        speed={settings.speed}
        onSpeedChange={(speed) => setSettings((s) => ({ ...s, speed }))}
        showDistanceSensor={settings.showDistanceSensor}
        onToggleDistanceSensor={() =>
          setSettings((s) => ({ ...s, showDistanceSensor: !s.showDistanceSensor }))
        }
        showLineSensors={settings.showLineSensors}
        onToggleLineSensors={() =>
          setSettings((s) => ({ ...s, showLineSensors: !s.showLineSensors }))
        }
        showGrid={settings.showGrid}
        onToggleGrid={() => setSettings((s) => ({ ...s, showGrid: !s.showGrid }))}
        highlightBlocks={settings.highlightBlocks}
        onToggleHighlight={() => setSettings((s) => ({ ...s, highlightBlocks: !s.highlightBlocks }))}
        statusText={statusText}
      />

      <Drawer open={helpOpen} title="Help and block reference" onClose={() => setHelpOpen(false)}>
        <HelpPanel />
      </Drawer>

      <Drawer
        open={projectsOpen}
        title="Projects and examples"
        onClose={() => setProjectsOpen(false)}
      >
        <ProjectManager
          onOpen={(file, id) => {
            handleStop();
            applyProjectFile(file, id);
            setProjectsOpen(false);
          }}
          onImport={(file) => {
            handleStop();
            applyProjectFile(file, null);
            setProjectsOpen(false);
          }}
          onLoadStarter={handleLoadStarter}
          onExport={handleExport}
          onMessage={pushToast}
        />
      </Drawer>

      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <p className="sr-only">
        mBot VR is an independent educational simulator and is not an official Makeblock product.
      </p>
    </div>
  );
}

/** True when focus is inside the Blockly workspace, which has its own shortcuts. */
function isBlocklyFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(active?.closest?.('.injectionDiv'));
}
