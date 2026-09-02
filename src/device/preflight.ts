import type * as Blockly from 'blockly/core';
import type { HardwareIssue } from './types';

/**
 * Blocks with no physical-robot equivalent at all - see
 * `docs/hardware-bridge-plan.md` §10's compatibility table. Blocking, with no
 * override: a real mBot cannot sense its own position, full stop.
 */
const SIMULATOR_ONLY_BLOCKS: Record<string, string> = {
  mbot_robot_x: 'Robot x position only works in the simulator - a real mBot cannot sense its own position.',
  mbot_robot_y: 'Robot y position only works in the simulator - a real mBot cannot sense its own position.',
  mbot_robot_heading: 'Robot heading only works in the simulator - a real mBot cannot sense its own heading.',
};

/** Blocks that need an optional add-on module this app cannot assume is present. */
const DISPLAY_BLOCKS: Record<string, string> = {
  mbot_display_number: 'This robot has no four-digit display configured, so this block would do nothing.',
  mbot_clear_display: 'This robot has no four-digit display configured, so this block would do nothing.',
};

/** Blocks whose real-hardware behaviour is genuinely ambiguous, not simply unavailable. */
const AMBIGUOUS_BLOCKS: Record<string, string> = {
  mbot_line_detects:
    '"Black" and "white" depend on this robot\'s lighting and the floor it is on - test it before relying on it.',
};

export interface PreflightOptions {
  /** Whether a Me 7-Segment display module has been configured for the target robot. */
  hasDisplay?: boolean;
}

/**
 * Walks every block in the workspace - not just the ones reachable from
 * `when program starts`, so a student sees a warning even for a block they haven't
 * wired up yet - and classifies each against the compatibility table.
 *
 * Deliberately a separate pass from `compileWorkspace()` rather than a new field on
 * `CompileResult`: it keeps `blocks/compile.ts`'s existing return shape, and therefore
 * `tests/compile.test.ts`, completely untouched (see `docs/hardware-bridge-plan.md`
 * §10 and §13).
 */
export function assessHardwareCompatibility(
  workspace: Blockly.Workspace,
  options: PreflightOptions = {},
): HardwareIssue[] {
  const issues: HardwareIssue[] = [];

  for (const block of workspace.getAllBlocks(false)) {
    const type = block.type;

    if (type in SIMULATOR_ONLY_BLOCKS) {
      issues.push({ severity: 'blocking', blockId: block.id, blockType: type, message: SIMULATOR_ONLY_BLOCKS[type] });
      continue;
    }

    if (type in DISPLAY_BLOCKS && !options.hasDisplay) {
      issues.push({ severity: 'blocking', blockId: block.id, blockType: type, message: DISPLAY_BLOCKS[type] });
      continue;
    }

    if (type in AMBIGUOUS_BLOCKS) {
      issues.push({ severity: 'warning', blockId: block.id, blockType: type, message: AMBIGUOUS_BLOCKS[type] });
    }
  }

  return issues;
}

/** True when at least one issue would stop a send from proceeding at all. */
export function hasBlockingIssue(issues: readonly HardwareIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocking');
}
