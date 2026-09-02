import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { defineMbotBlocks } from '../src/blocks/defineBlocks';
import { EMPTY_WORKSPACE, STARTER_PROGRAMS } from '../src/blocks/starters';
import { assessHardwareCompatibility, hasBlockingIssue } from '../src/device/preflight';

defineMbotBlocks();

function workspaceFrom(state: object): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
}

function workspaceWithBlocks(types: string[]): Blockly.Workspace {
  return workspaceFrom({
    blocks: {
      languageVersion: 0,
      blocks: types.map((type, i) => ({ type, x: i * 40, y: 0 })),
    },
  });
}

describe('assessHardwareCompatibility', () => {
  it('reports no issues for an empty workspace', () => {
    const workspace = workspaceFrom(EMPTY_WORKSPACE as object);
    expect(assessHardwareCompatibility(workspace)).toEqual([]);
    workspace.dispose();
  });

  it('blocks robot x/y/heading with no override', () => {
    const workspace = workspaceWithBlocks(['mbot_robot_x', 'mbot_robot_y', 'mbot_robot_heading']);
    const issues = assessHardwareCompatibility(workspace);
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.severity === 'blocking')).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(true);
    workspace.dispose();
  });

  it('blocks the display blocks when no display is configured', () => {
    const workspace = workspaceWithBlocks(['mbot_display_number', 'mbot_clear_display']);
    const issues = assessHardwareCompatibility(workspace);
    expect(issues.every((i) => i.severity === 'blocking')).toBe(true);
    workspace.dispose();
  });

  it('allows the display blocks when a display is configured', () => {
    const workspace = workspaceWithBlocks(['mbot_display_number', 'mbot_clear_display']);
    const issues = assessHardwareCompatibility(workspace, { hasDisplay: true });
    expect(issues).toEqual([]);
    workspace.dispose();
  });

  it('warns, but does not block, on the ambiguous line-colour block', () => {
    const workspace = workspaceWithBlocks(['mbot_line_detects']);
    const issues = assessHardwareCompatibility(workspace);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(hasBlockingIssue(issues)).toBe(false);
    workspace.dispose();
  });

  it('reports no issues for blocks with a direct hardware mapping', () => {
    const workspace = workspaceWithBlocks([
      'mbot_move_direction',
      'mbot_set_motors',
      'mbot_stop_motors',
      'mbot_ultrasonic',
      'mbot_left_on_line',
      'mbot_set_led_named',
      'mbot_wait',
      'mbot_forever',
    ]);
    expect(assessHardwareCompatibility(workspace)).toEqual([]);
    workspace.dispose();
  });

  it('identifies the offending block by id, so the workspace can highlight it', () => {
    const workspace = workspaceWithBlocks(['mbot_robot_x']);
    const [issue] = assessHardwareCompatibility(workspace);
    const [block] = workspace.getAllBlocks(false);
    expect(issue.blockId).toBe(block.id);
    workspace.dispose();
  });

  it('every starter program is free of blocking issues', () => {
    for (const starter of STARTER_PROGRAMS) {
      const workspace = workspaceFrom(starter.workspace as object);
      const issues = assessHardwareCompatibility(workspace, { hasDisplay: true });
      expect(hasBlockingIssue(issues)).toBe(false);
      workspace.dispose();
    }
  });
});
