import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { defineMbotBlocks } from '../src/blocks/defineBlocks';
import { EMPTY_WORKSPACE, STARTER_PROGRAMS } from '../src/blocks/starters';
import {
  BytecodeCompileError,
  PLAYER_BYTECODE_MAGIC,
  PLAYER_BYTECODE_VERSION,
  PLAYER_MAX_PROGRAM_BYTES,
  PlayerOp,
  checksum16,
  compileWorkspaceToPlayerBytecode,
} from '../src/device/bytecode';

defineMbotBlocks();

function workspaceFrom(state: object): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
}

function program(block: object): object {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: 'mbot_when_start', next: { block } }],
    },
  };
}

describe('compileWorkspaceToPlayerBytecode', () => {
  it('wraps instructions in a versioned header with length and checksum', () => {
    const workspace = workspaceFrom(EMPTY_WORKSPACE as object);

    const result = compileWorkspaceToPlayerBytecode(workspace);

    expect(Array.from(result.bytes.slice(0, 4))).toEqual(Array.from(PLAYER_BYTECODE_MAGIC));
    expect(result.bytes[4]).toBe(PLAYER_BYTECODE_VERSION);
    expect(result.bytes[6] | (result.bytes[7] << 8)).toBe(result.instructionBytes.length);
    expect(result.bytes[8] | (result.bytes[9] << 8)).toBe(checksum16(result.instructionBytes));
    expect(result.instructionBytes.at(-1)).toBe(PlayerOp.END);
    workspace.dispose();
  });

  it.each(STARTER_PROGRAMS.map((starter) => [starter.id, starter] as const))(
    'compiles starter "%s" into an EEPROM-sized program',
    (_id, starter) => {
      const workspace = workspaceFrom(starter.workspace as object);
      const result = compileWorkspaceToPlayerBytecode(workspace);

      expect(result.byteLength).toBeLessThanOrEqual(PLAYER_MAX_PROGRAM_BYTES);
      expect(result.instructionBytes.length).toBeGreaterThan(0);
      workspace.dispose();
    },
  );

  it('emits the same robot vocabulary for a timed forward block: motors, wait, stop', () => {
    const workspace = workspaceFrom(
      program({
        type: 'mbot_move_forward_for',
        inputs: {
          POWER: { shadow: { type: 'math_number', fields: { NUM: 50 } } },
          SECONDS: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
        },
      }),
    );

    const result = compileWorkspaceToPlayerBytecode(workspace);

    expect(Array.from(result.instructionBytes)).toContain(PlayerOp.SET_MOTORS);
    expect(Array.from(result.instructionBytes)).toContain(PlayerOp.WAIT_MS);
    expect(Array.from(result.instructionBytes)).toContain(PlayerOp.STOP_MOTORS);
    workspace.dispose();
  });

  it('rejects dynamic wait times because the first bytecode VM only stores fixed delays', () => {
    const workspace = workspaceFrom(
      program({
        type: 'mbot_wait',
        inputs: {
          SECONDS: { block: { type: 'mbot_timer' } },
        },
      }),
    );

    expect(() => compileWorkspaceToPlayerBytecode(workspace)).toThrow(BytecodeCompileError);
    workspace.dispose();
  });

  it('rejects programs that exceed the reserved EEPROM program slot', () => {
    let tail: object = { type: 'mbot_stop_motors' };
    for (let i = 0; i < PLAYER_MAX_PROGRAM_BYTES; i += 1) {
      tail = { type: 'mbot_stop_motors', next: { block: tail } };
    }
    const workspace = workspaceFrom(program(tail));

    expect(() => compileWorkspaceToPlayerBytecode(workspace)).toThrow(/store at most/);
    workspace.dispose();
  });
});
