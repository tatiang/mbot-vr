/**
 * A disassembler + static validator for the Player bytecode emitted by
 * `src/device/bytecode.ts`, used by `tests/playerBytecode.test.ts`.
 *
 * This is deliberately NOT an executing VM. It is an independent model of the
 * instruction encoding and control-flow rules written from `docs/player-protocol.md`,
 * so that a change to the compiler that produces a malformed stream - a jump into the
 * middle of an instruction, an unbalanced `if`/`else`, a truncated immediate, a missing
 * terminator - fails a test instead of only failing on a real robot. The firmware
 * (`firmware/mbotvr-player/mbotvr-player.ino`) must agree with the same spec.
 */

import { PlayerOp } from '../../src/device/bytecode';

/** Bytes of immediate operand that follow each opcode byte. */
const IMMEDIATE_SIZE: Record<number, number> = {
  [PlayerOp.PUSH_I16]: 2,
  [PlayerOp.JUMP]: 2,
  [PlayerOp.JUMP_IF_FALSE]: 2,
  [PlayerOp.WAIT_MS]: 2,
  [PlayerOp.SET_RGB_LED]: 4,
  [PlayerOp.DISPLAY_NUMBER]: 2,
};

/** Net change to the operand-stack depth. */
const STACK_EFFECT: Record<number, number> = {
  [PlayerOp.END]: 0,
  [PlayerOp.PUSH_I16]: 1,
  [PlayerOp.ADD]: -1,
  [PlayerOp.SUB]: -1,
  [PlayerOp.MUL]: -1,
  [PlayerOp.DIV]: -1,
  [PlayerOp.LT]: -1,
  [PlayerOp.GT]: -1,
  [PlayerOp.EQ]: -1,
  [PlayerOp.AND]: -1,
  [PlayerOp.OR]: -1,
  [PlayerOp.NOT]: 0,
  [PlayerOp.JUMP]: 0,
  [PlayerOp.JUMP_IF_FALSE]: -1,
  [PlayerOp.SET_MOTORS]: -2,
  [PlayerOp.STOP_MOTORS]: 0,
  [PlayerOp.WAIT_MS]: 0,
  [PlayerOp.SET_RGB_LED]: 0,
  [PlayerOp.DISPLAY_NUMBER]: 0,
  [PlayerOp.CLEAR_DISPLAY]: 0,
  [PlayerOp.READ_ULTRASONIC_CM]: 1,
  [PlayerOp.READ_LINE_VALUE]: 1,
  [PlayerOp.READ_LEFT_ON_LINE]: 1,
  [PlayerOp.READ_RIGHT_ON_LINE]: 1,
  [PlayerOp.READ_TIMER_DSEC]: 1,
  [PlayerOp.RESET_TIMER]: 0,
  [PlayerOp.POWER_TO_MOTOR]: 0,
  [PlayerOp.CM_WITHIN_OBSTACLE]: -1,
  [PlayerOp.DUP]: 1,
  [PlayerOp.POP]: -1,
};

/** Minimum stack depth an opcode needs on entry. */
const REQUIRED_DEPTH: Record<number, number> = {
  [PlayerOp.ADD]: 2,
  [PlayerOp.SUB]: 2,
  [PlayerOp.MUL]: 2,
  [PlayerOp.DIV]: 2,
  [PlayerOp.LT]: 2,
  [PlayerOp.GT]: 2,
  [PlayerOp.EQ]: 2,
  [PlayerOp.AND]: 2,
  [PlayerOp.OR]: 2,
  [PlayerOp.NOT]: 1,
  [PlayerOp.JUMP_IF_FALSE]: 1,
  [PlayerOp.SET_MOTORS]: 2,
  [PlayerOp.CM_WITHIN_OBSTACLE]: 2,
  [PlayerOp.DUP]: 1,
  [PlayerOp.POP]: 1,
};

const OP_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(PlayerOp).map(([name, value]) => [value, name]),
);

export interface DecodedInstruction {
  offset: number;
  op: number;
  name: string;
  /** Decoded immediate, if any: the i16/u16 value or the 4 RGB bytes. */
  immediate?: number | number[];
}

export interface DisassemblyResult {
  instructions: DecodedInstruction[];
  /** Byte offsets that begin an instruction - the only valid jump targets. */
  opcodeOffsets: Set<number>;
  errors: string[];
  ok: boolean;
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function i16(bytes: Uint8Array, at: number): number {
  const v = u16(bytes, at);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Decode the instruction stream linearly and run the static checks:
 *  - every opcode is known and its immediate fits inside the stream
 *  - the stream's last instruction is `END`
 *  - every jump target lands on an instruction boundary and inside the stream
 *  - a control-flow walk assigns each reachable instruction one consistent stack
 *    depth, no instruction runs with fewer stack entries than it pops, and control
 *    never falls off the end without hitting `END`
 */
export function disassemblePlayerProgram(instructions: Uint8Array): DisassemblyResult {
  const decoded: DecodedInstruction[] = [];
  const opcodeOffsets = new Set<number>();
  const errors: string[] = [];

  let pc = 0;
  while (pc < instructions.length) {
    const op = instructions[pc];
    const name = OP_NAME[op];
    if (name === undefined) {
      errors.push(`unknown opcode 0x${op.toString(16)} at ${pc}`);
      break;
    }
    opcodeOffsets.add(pc);
    const immSize = IMMEDIATE_SIZE[op] ?? 0;
    if (pc + 1 + immSize > instructions.length) {
      errors.push(`${name} at ${pc} has a truncated immediate`);
      break;
    }
    let immediate: number | number[] | undefined;
    if (op === PlayerOp.PUSH_I16 || op === PlayerOp.DISPLAY_NUMBER) immediate = i16(instructions, pc + 1);
    else if (op === PlayerOp.JUMP || op === PlayerOp.JUMP_IF_FALSE || op === PlayerOp.WAIT_MS)
      immediate = u16(instructions, pc + 1);
    else if (op === PlayerOp.SET_RGB_LED) immediate = Array.from(instructions.subarray(pc + 1, pc + 5));
    decoded.push({ offset: pc, op, name, immediate });
    pc += 1 + immSize;
  }

  if (errors.length === 0) {
    if (pc !== instructions.length) errors.push(`decode stopped at ${pc} of ${instructions.length} bytes`);
    if (decoded.length === 0 || decoded[decoded.length - 1].op !== PlayerOp.END)
      errors.push('stream does not end with END');
  }

  // Jump-target boundary check.
  for (const ins of decoded) {
    if (ins.op !== PlayerOp.JUMP && ins.op !== PlayerOp.JUMP_IF_FALSE) continue;
    const target = ins.immediate as number;
    if (target >= instructions.length) errors.push(`${ins.name} at ${ins.offset} targets ${target}, past the stream`);
    else if (!opcodeOffsets.has(target))
      errors.push(`${ins.name} at ${ins.offset} targets ${target}, not an instruction boundary`);
  }

  if (errors.length === 0) walkControlFlow(decoded, instructions.length, errors);

  return { instructions: decoded, opcodeOffsets, errors, ok: errors.length === 0 };
}

function walkControlFlow(decoded: DecodedInstruction[], streamLength: number, errors: string[]): void {
  const byOffset = new Map(decoded.map((ins) => [ins.offset, ins]));
  const entryDepth = new Map<number, number>();
  const queue: Array<{ pc: number; depth: number }> = [{ pc: 0, depth: 0 }];

  while (queue.length > 0) {
    const { pc, depth } = queue.pop()!;
    if (pc === streamLength) {
      errors.push('control fell off the end of the stream without END');
      return;
    }
    const ins = byOffset.get(pc);
    if (!ins) {
      errors.push(`control reached ${pc}, not an instruction boundary`);
      return;
    }
    const seen = entryDepth.get(pc);
    if (seen !== undefined) {
      if (seen !== depth) errors.push(`instruction at ${pc} is reachable with stack depth ${seen} and ${depth}`);
      continue;
    }
    entryDepth.set(pc, depth);

    const need = REQUIRED_DEPTH[ins.op] ?? 0;
    if (depth < need) {
      errors.push(`${ins.name} at ${pc} pops ${need} but only ${depth} on the stack`);
      return;
    }
    const nextDepth = depth + (STACK_EFFECT[ins.op] ?? 0);
    const immSize = IMMEDIATE_SIZE[ins.op] ?? 0;
    const fallthrough = pc + 1 + immSize;

    if (ins.op === PlayerOp.END) continue;
    if (ins.op === PlayerOp.JUMP) {
      queue.push({ pc: ins.immediate as number, depth: nextDepth });
      continue;
    }
    if (ins.op === PlayerOp.JUMP_IF_FALSE) {
      queue.push({ pc: ins.immediate as number, depth: nextDepth });
      queue.push({ pc: fallthrough, depth: nextDepth });
      continue;
    }
    queue.push({ pc: fallthrough, depth: nextDepth });
  }
}

/** Convenience for tests: the ordered opcode names, immediates dropped. */
export function opcodeSequence(instructions: Uint8Array): string[] {
  return disassemblePlayerProgram(instructions).instructions.map((ins) => ins.name);
}
