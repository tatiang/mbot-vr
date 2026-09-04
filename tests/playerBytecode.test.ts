import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { defineMbotBlocks } from '../src/blocks/defineBlocks';
import { EMPTY_WORKSPACE, STARTER_PROGRAMS } from '../src/blocks/starters';
import { PlayerOp, compileWorkspaceToPlayerBytecode } from '../src/device/bytecode';
import { disassemblePlayerProgram, opcodeSequence } from './support/playerBytecode';

defineMbotBlocks();

function workspaceFrom(state: object): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
}

/** Wrap a single statement block under `when program starts`. */
function program(block: object): object {
  return { blocks: { languageVersion: 0, blocks: [{ type: 'mbot_when_start', next: { block } }] } };
}

function instructionsFor(state: object): Uint8Array {
  const workspace = workspaceFrom(state);
  try {
    return compileWorkspaceToPlayerBytecode(workspace).instructionBytes;
  } finally {
    workspace.dispose();
  }
}

const shadowNumber = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });

describe('disassemblePlayerProgram', () => {
  it('accepts the empty program (just the STOP_MOTORS / END the compiler appends)', () => {
    const result = disassemblePlayerProgram(instructionsFor(EMPTY_WORKSPACE as object));
    expect(result.ok).toBe(true);
    expect(opcodeSequence(instructionsFor(EMPTY_WORKSPACE as object))).toEqual(['STOP_MOTORS', 'END']);
  });

  it.each(STARTER_PROGRAMS.map((s) => [s.id, s] as const))(
    'every starter "%s" disassembles to a well-formed, stack-balanced stream',
    (_id, starter) => {
      const result = disassemblePlayerProgram(instructionsFor(starter.workspace as object));
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  it('lays a timed forward block out as PUSH PUSH SET_MOTORS WAIT_MS STOP_MOTORS', () => {
    const seq = opcodeSequence(
      instructionsFor(
        program({
          type: 'mbot_move_forward_for',
          inputs: { POWER: shadowNumber(50), SECONDS: shadowNumber(2) },
        }),
      ),
    );
    expect(seq).toEqual(['PUSH_I16', 'PUSH_I16', 'SET_MOTORS', 'WAIT_MS', 'STOP_MOTORS', 'STOP_MOTORS', 'END']);
  });

  it('keeps the stack balanced across an if / else with unequal branch bodies', () => {
    const result = disassemblePlayerProgram(
      instructionsFor(
        program({
          type: 'controls_if',
          extraState: { hasElse: true },
          inputs: {
            IF0: { block: { type: 'mbot_left_on_line' } },
            DO0: { block: { type: 'mbot_stop_motors' } },
            ELSE: {
              block: {
                type: 'mbot_set_motors',
                inputs: { LEFT: shadowNumber(40), RIGHT: shadowNumber(60) },
              },
            },
          },
        }),
      ),
    );
    expect(result.errors).toEqual([]);
  });

  it('resolves the back-edge of a repeat-until loop to an instruction boundary', () => {
    const result = disassemblePlayerProgram(
      instructionsFor(
        program({
          type: 'mbot_repeat_until',
          inputs: {
            CONDITION: { block: { type: 'mbot_obstacle_within', inputs: { DISTANCE: shadowNumber(15) } } },
            DO: { block: { type: 'mbot_move_direction', fields: { DIRECTION: 'forward' }, inputs: { POWER: shadowNumber(50) } } },
          },
        }),
      ),
    );
    expect(result.errors).toEqual([]);
    const jumps = result.instructions.filter((i) => i.name === 'JUMP' || i.name === 'JUMP_IF_FALSE');
    expect(jumps.length).toBeGreaterThan(0);
    for (const jump of jumps) expect(result.opcodeOffsets.has(jump.immediate as number)).toBe(true);
  });

  it('compiles a forever loop that jumps back to its own start with no fall-through', () => {
    const result = disassemblePlayerProgram(
      instructionsFor(
        program({
          type: 'mbot_forever',
          inputs: { DO: { block: { type: 'mbot_stop_motors' } } },
        }),
      ),
    );
    expect(result.ok).toBe(true);
    const back = result.instructions.find((i) => i.name === 'JUMP');
    expect(back?.immediate).toBe(0);
  });
});

describe('disassemblePlayerProgram catches malformed streams', () => {
  const good = instructionsFor(
    program({ type: 'mbot_move_forward_for', inputs: { POWER: shadowNumber(50), SECONDS: shadowNumber(1) } }),
  );

  it('rejects a stream with no END terminator', () => {
    const truncated = good.subarray(0, good.length - 1);
    expect(disassemblePlayerProgram(truncated).ok).toBe(false);
  });

  it('rejects a jump into the middle of a PUSH_I16 immediate', () => {
    const bytes = Uint8Array.from([
      PlayerOp.PUSH_I16, 0x0a, 0x00,
      PlayerOp.JUMP, 0x01, 0x00, // target 1 = the low byte of the PUSH immediate
      PlayerOp.STOP_MOTORS,
      PlayerOp.END,
    ]);
    const result = disassemblePlayerProgram(bytes);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not an instruction boundary/);
  });

  it('rejects a branch that leaves the stack unbalanced', () => {
    // PUSH, JUMP_IF_FALSE past a stray PUSH: the two paths into END disagree on depth.
    const bytes = Uint8Array.from([
      PlayerOp.PUSH_I16, 0x01, 0x00,        // 0: depth -> 1
      PlayerOp.JUMP_IF_FALSE, 0x0a, 0x00,   // 3: pop -> 0, target 10
      PlayerOp.PUSH_I16, 0x02, 0x00,        // 6: depth -> 1 on the fall-through path
      PlayerOp.STOP_MOTORS,                 // 9
      PlayerOp.END,                         // 10: reached with depth 1 and depth 0
    ]);
    const result = disassemblePlayerProgram(bytes);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/stack depth/);
  });

  it('rejects an unknown opcode', () => {
    const bytes = Uint8Array.from([0xfe, PlayerOp.END]);
    expect(disassemblePlayerProgram(bytes).ok).toBe(false);
  });
});
