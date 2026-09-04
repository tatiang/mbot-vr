import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Blockly from 'blockly/core';
import { compileWorkspace } from '../blocks/compile';
import { BytecodeCompileError, compileWorkspaceToPlayerBytecode } from '../device/bytecode';
import { describePlayerInfo, parsePlayerInfo } from '../device/playerInfo';
import { assessHardwareCompatibility, hasBlockingIssue } from '../device/preflight';
import { createSerialRuntime } from '../device/SerialRobotRuntime';
import { isConnected } from '../device/types';
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog';
import { useDeviceSession } from '../hooks/useDeviceSession';
import { ProgramRunner } from '../runtime/ProgramRunner';
import { Collapsible } from './ui';
import { DevicePanel } from './DevicePanel';
import { StopBanner } from './StopBanner';
import { PreflightList } from './PreflightList';
import { DiagnosticsPanel } from './DiagnosticsPanel';

interface Props {
  getWorkspace: () => Blockly.Workspace | null;
  onHighlight: (blockId: string | null) => void;
  pushToast: (kind: 'info' | 'error' | 'success', text: string) => void;
  diagnosticLog: DiagnosticLog;
  appVersion: string;
  /** Bumped whenever the workspace changes, so preflight results stay current while building. */
  refreshToken: number;
}

/**
 * The whole physical-robot feature in one component: connect, identify, preflight,
 * run, and the stop escalation ladder. Lazy-loaded from `App.tsx` behind
 * `isHardwareFeatureEnabled()` (see `src/device/featureFlag.ts`), so none of this - or
 * `src/device/*`'s protocol/session/runtime code - is downloaded for a student who
 * never turns the feature on.
 *
 * Owns its own `ProgramRunner`, independent of the simulator's, pointed at
 * `createSerialRuntime` instead of `createEngineRuntime`. Running on the robot and
 * running in the simulator are unrelated activities - a class can compare the two
 * side by side - so this deliberately does not block or get blocked by the
 * simulator's own Run/Stop.
 */
export function DeviceSection({ getWorkspace, onHighlight, pushToast, diagnosticLog, appVersion, refreshToken }: Props) {
  const controller = useDeviceSession(diagnosticLog);
  const runnerRef = useRef<ProgramRunner | null>(null);
  const [running, setRunning] = useState(false);
  const [issues, setIssues] = useState<ReturnType<typeof assessHardwareCompatibility>>([]);
  const [storeIssues, setStoreIssues] = useState<ReturnType<typeof assessHardwareCompatibility>>([]);

  useEffect(() => {
    const workspace = getWorkspace();
    if (!workspace) {
      setIssues([]);
      setStoreIssues([]);
      return;
    }
    const profile = controller.getSession()?.getProfile();
    setIssues(assessHardwareCompatibility(workspace, { hasDisplay: profile?.hasDisplay ?? false }));
    setStoreIssues(
      assessHardwareCompatibility(workspace, {
        hasDisplay: profile?.hasDisplay ?? false,
        onRobotProgram: true,
      }),
    );
    // `controller.status` is included so a fresh identify (which can resolve a new
    // profile, e.g. a configured display) re-runs this; `controller.getSession` itself
    // is a stable closure and would not otherwise trigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, controller.status, getWorkspace]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  const handleStop = useCallback(async () => {
    runnerRef.current?.stop();
    setRunning(false);
    const outcome = await controller.stop();
    if (outcome === 'unconfirmed') {
      pushToast('error', 'Your robot may still be moving. Pick it up and switch it off.');
    }
  }, [controller, pushToast]);

  const handleRun = useCallback(() => {
    const workspace = getWorkspace();
    const session = controller.getSession();
    if (!workspace || !session) return;

    if (hasBlockingIssue(issues)) {
      pushToast('error', 'One of your blocks only works in the simulator - it needs to come out before this can run on the robot.');
      return;
    }

    let compiled;
    try {
      compiled = compileWorkspace(workspace, { highlight: true });
    } catch {
      pushToast('error', 'Those blocks could not be turned into a program. Try undoing your last change.');
      return;
    }
    if (!compiled.hasStart) {
      pushToast('info', 'Add a "when program starts" block from the Start category first.');
      return;
    }
    if (compiled.attachedBlocks === 0) {
      pushToast('info', 'Drag some blocks underneath "when program starts", then press Run on robot.');
      return;
    }

    runnerRef.current?.dispose();
    const runtime = createSerialRuntime(session);
    const runner = new ProgramRunner(runtime, {
      onHighlight,
      onFinished: () => {
        setRunning(false);
        // Hardware programs end stopped, unlike the simulator's deliberate latching -
        // a real motor left spinning unattended is a safety problem, not a teaching
        // moment. Goes through the full ladder so the state stays evidence-gated.
        void handleStop();
      },
      onError: (message, detail) => {
        setRunning(false);
        pushToast('error', message);
        diagnosticLog.logError('Robot program error', new Error(detail));
        void handleStop();
      },
    });
    runnerRef.current = runner;
    session.beginRun();
    setRunning(true);
    runner.start(compiled.code);
  }, [controller, getWorkspace, handleStop, issues, onHighlight, pushToast, diagnosticLog]);

  const handleStoreProgram = useCallback(async () => {
    const workspace = getWorkspace();
    const session = controller.getSession();
    if (!workspace || !session) return;

    if (controller.status.phase === 'ready' && controller.status.link === 'bluetooth') {
      pushToast('error', 'Programs can only be put on the robot through the cable.');
      return;
    }
    if (!session.getProfile().supportsOnRobotPrograms) {
      pushToast('error', 'This robot needs mBot VR Player firmware before it can store programs.');
      return;
    }
    if (hasBlockingIssue(storeIssues)) {
      pushToast('error', 'Fix the blocked items below before putting this program on the robot.');
      return;
    }

    try {
      const compiled = compileWorkspace(workspace, { highlight: false });
      if (!compiled.hasStart) {
        pushToast('info', 'Add a "when program starts" block before putting this on your robot.');
        return;
      }
      if (compiled.attachedBlocks === 0) {
        pushToast('info', 'Drag some blocks underneath "when program starts", then put it on your robot.');
        return;
      }
      const program = compileWorkspaceToPlayerBytecode(workspace);
      await session.writeStoredProgram(program.bytes, program.checksum);
      pushToast('success', 'Program is on your robot.');
    } catch (error) {
      diagnosticLog.logError('Stored program transfer failed', error);
      const message =
        error instanceof BytecodeCompileError
          ? error.message
          : 'Program did not make it onto the robot. Run it with the cable instead.';
      pushToast('error', message);
    }
  }, [controller, diagnosticLog, getWorkspace, pushToast, storeIssues]);

  const handleClearStoredProgram = useCallback(async () => {
    const session = controller.getSession();
    if (!session) return;
    if (!session.getProfile().supportsOnRobotPrograms) {
      pushToast('error', 'This robot needs mBot VR Player firmware before stored programs can be cleared.');
      return;
    }
    if (!window.confirm("Clear the program stored on this robot? It will stay idle after it restarts.")) return;

    try {
      await session.clearStoredProgram();
      pushToast('success', "Robot program cleared. It will stay idle after it restarts.");
    } catch (error) {
      diagnosticLog.logError('Stored program clear failed', error);
      pushToast('error', "The robot's stored program was not cleared. Keep it connected and try again.");
    }
  }, [controller, diagnosticLog, pushToast]);

  const handleCheckRobotInfo = useCallback(async () => {
    const session = controller.getSession();
    if (!session) return;
    try {
      const raw = await session.getPlayerInfoRaw();
      const info = parsePlayerInfo(raw);
      if (!info) {
        pushToast('error', "Got a reply, but couldn't make sense of it. Check Diagnostics for the raw bytes.");
        diagnosticLog.logError('Unparseable Player INFO reply', new Error(raw));
        return;
      }
      pushToast('info', describePlayerInfo(info));
    } catch (error) {
      diagnosticLog.logError('Player INFO request failed', error);
      pushToast('error', "Couldn't check what's stored on the robot. Keep it connected and try again.");
    }
  }, [controller, diagnosticLog, pushToast]);

  const handleFocusBlock = useCallback(
    (blockId: string) => {
      onHighlight(blockId);
      setTimeout(() => onHighlight(null), 1500);
    },
    [onHighlight],
  );

  const connected = isConnected(controller.status);
  const connectedProfile = connected && 'profile' in controller.status ? controller.status.profile : null;
  const connectedLink = connected && 'link' in controller.status ? controller.status.link : null;
  const transferring = controller.status.phase === 'sending' || controller.status.phase === 'verifying';
  const storeDisabledReason =
    connected && controller.status.phase !== 'stopUnconfirmed' && controller.status.phase !== 'stopping'
      ? connectedLink === 'bluetooth'
        ? 'Putting a program on the robot needs the cable. Wireless can only drive it live.'
        : !connectedProfile?.supportsOnRobotPrograms
          ? 'On-robot programs need mBot VR Player firmware. Use Run on robot for tethered control.'
          : hasBlockingIssue(storeIssues)
            ? 'Fix the blocked items below before putting this program on the robot.'
            : undefined
      : undefined;
  const stopState = controller.status.phase === 'stopping' || controller.status.phase === 'stopUnconfirmed';
  const storeDisabled = running || transferring || stopState || Boolean(storeDisabledReason) || !connectedProfile?.supportsOnRobotPrograms;
  const clearDisabled =
    running ||
    transferring ||
    stopState ||
    connectedLink === 'bluetooth' ||
    !connectedProfile?.supportsOnRobotPrograms;
  const runDisabledReason = hasBlockingIssue(issues)
    ? 'Fix the blocked items below before running on the robot.'
    : undefined;
  const shownIssues = connectedProfile?.supportsOnRobotPrograms ? storeIssues : issues;

  return (
    <>
      <Collapsible title="My robot" defaultOpen={connected}>
        <DevicePanel
          status={controller.status}
          capabilities={controller.capabilities}
          onConnect={controller.connect}
          onConfirmIdentity={controller.confirmIdentity}
          onRejectIdentity={controller.rejectIdentity}
          onWinkAgain={controller.wink}
          onDisconnect={controller.disconnect}
          onRun={handleRun}
          onStop={() => void handleStop()}
          onStoreProgram={() => void handleStoreProgram()}
          onClearStoredProgram={() => void handleClearStoredProgram()}
          onCheckRobotInfo={() => void handleCheckRobotInfo()}
          running={running}
          runDisabled={hasBlockingIssue(issues)}
          runDisabledReason={runDisabledReason}
          storeDisabled={storeDisabled}
          clearDisabled={clearDisabled}
          storeDisabledReason={storeDisabledReason}
          infoAvailable={Boolean(connectedProfile?.supportsOnRobotPrograms)}
        />
        {controller.status.phase === 'stopUnconfirmed' && (
          <StopBanner onStop={() => void handleStop()} onAcknowledge={controller.acknowledgeStopUnconfirmed} />
        )}
      </Collapsible>

      {connected && (
        <Collapsible title="Robot compatibility check">
          <PreflightList issues={shownIssues} onFocusBlock={handleFocusBlock} />
        </Collapsible>
      )}

      <Collapsible title="Diagnostics">
        <DiagnosticsPanel log={diagnosticLog} appVersion={appVersion} onMessage={pushToast} />
      </Collapsible>
    </>
  );
}
