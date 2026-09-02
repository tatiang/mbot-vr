import type * as Blockly from 'blockly/core';
import { START_BLOCK_TYPE } from '../blocks/compile';

export const PLAYER_BYTECODE_MAGIC = [0x4d, 0x42, 0x56, 0x52] as const; // "MBVR"
export const PLAYER_BYTECODE_VERSION = 1;
export const PLAYER_EEPROM_CAPACITY_BYTES = 1024;
export const PLAYER_RESERVED_EEPROM_BYTES = 128;
export const PLAYER_MAX_PROGRAM_BYTES = PLAYER_EEPROM_CAPACITY_BYTES - PLAYER_RESERVED_EEPROM_BYTES;

const HEADER_BYTES = 10;
const MAX_I16 = 32767;
const MIN_I16 = -32768;
const MAX_U16 = 65535;

export const PlayerOp = {
  END: 0x00,
  PUSH_I16: 0x01,
  ADD: 0x02,
  SUB: 0x03,
  MUL: 0x04,
  DIV: 0x05,
  LT: 0x06,
  GT: 0x07,
  EQ: 0x08,
  AND: 0x09,
  OR: 0x0a,
  NOT: 0x0b,
  JUMP: 0x0c,
  JUMP_IF_FALSE: 0x0d,
  SET_MOTORS: 0x10,
  STOP_MOTORS: 0x11,
  WAIT_MS: 0x12,
  SET_RGB_LED: 0x13,
  DISPLAY_NUMBER: 0x14,
  CLEAR_DISPLAY: 0x15,
  READ_ULTRASONIC_CM: 0x20,
  READ_LINE_VALUE: 0x21,
  READ_LEFT_ON_LINE: 0x22,
  READ_RIGHT_ON_LINE: 0x23,
  READ_TIMER_DSEC: 0x24,
  RESET_TIMER: 0x25,
  POWER_TO_MOTOR: 0x30,
  CM_WITHIN_OBSTACLE: 0x31,
  DUP: 0x32,
  POP: 0x33,
} as const;

export class BytecodeCompileError extends Error {
  readonly blockId?: string;
  readonly blockType?: string;

  constructor(message: string, block?: Blockly.Block | null) {
    super(message);
    this.name = 'BytecodeCompileError';
    this.blockId = block?.id;
    this.blockType = block?.type;
  }
}

export interface PlayerBytecodeProgram {
  bytes: Uint8Array;
  instructionBytes: Uint8Array;
  checksum: number;
  byteLength: number;
}

class Builder {
  private readonly bytes: number[] = [];

  get offset(): number {
    return this.bytes.length;
  }

  emit(byte: number): void {
    this.bytes.push(byte & 0xff);
  }

  emitI16(value: number): void {
    const clamped = clampInt(value, MIN_I16, MAX_I16);
    const encoded = clamped < 0 ? clamped + 0x10000 : clamped;
    this.bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
  }

  emitU16(value: number): void {
    const clamped = clampInt(value, 0, MAX_U16);
    this.bytes.push(clamped & 0xff, (clamped >> 8) & 0xff);
  }

  emitJump(op: number): number {
    this.emit(op);
    const patchAt = this.offset;
    this.emitU16(0);
    return patchAt;
  }

  patchU16(offset: number, value: number): void {
    if (offset < 0 || offset + 1 >= this.bytes.length) throw new Error('Invalid bytecode patch offset.');
    this.bytes[offset] = value & 0xff;
    this.bytes[offset + 1] = (value >> 8) & 0xff;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export function compileWorkspaceToPlayerBytecode(workspace: Blockly.Workspace): PlayerBytecodeProgram {
  const startBlock = workspace.getBlocksByType(START_BLOCK_TYPE, true)[0] ?? null;
  const builder = new Builder();

  if (startBlock) compileStatementChain(startBlock.getNextBlock(), builder);
  builder.emit(PlayerOp.STOP_MOTORS);
  builder.emit(PlayerOp.END);

  const instructions = builder.toUint8Array();
  const checksum = checksum16(instructions);
  const bytes = new Uint8Array(HEADER_BYTES + instructions.length);
  bytes.set(PLAYER_BYTECODE_MAGIC, 0);
  bytes[4] = PLAYER_BYTECODE_VERSION;
  bytes[5] = 0;
  writeU16LE(bytes, 6, instructions.length);
  writeU16LE(bytes, 8, checksum);
  bytes.set(instructions, HEADER_BYTES);

  if (bytes.length > PLAYER_MAX_PROGRAM_BYTES) {
    throw new BytecodeCompileError(
      `This program is ${bytes.length} bytes, but the robot can store at most ${PLAYER_MAX_PROGRAM_BYTES} bytes.`,
    );
  }

  return { bytes, instructionBytes: instructions, checksum, byteLength: bytes.length };
}

export function checksum16(bytes: Uint8Array): number {
  let a = 0;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 255;
    b = (b + a) % 255;
  }
  return (b << 8) | a;
}

function compileStatementChain(first: Blockly.Block | null, builder: Builder): void {
  let block = first;
  while (block) {
    compileStatement(block, builder);
    block = block.getNextBlock();
  }
}

function compileStatement(block: Blockly.Block, builder: Builder): void {
  switch (block.type) {
    case 'mbot_move_forward_for': {
      compileTimedMotion(block, builder, 1, 1);
      return;
    }
    case 'mbot_move_backward_for': {
      compileTimedMotion(block, builder, -1, -1);
      return;
    }
    case 'mbot_turn_left_for': {
      compileTimedMotion(block, builder, -1, 1);
      return;
    }
    case 'mbot_turn_right_for': {
      compileTimedMotion(block, builder, 1, -1);
      return;
    }
    case 'mbot_move_direction': {
      const direction = String(block.getFieldValue('DIRECTION'));
      const [leftSign, rightSign] =
        direction === 'backward' ? [-1, -1] : direction === 'left' ? [-1, 1] : direction === 'right' ? [1, -1] : [1, 1];
      compilePowerPair(block, builder, 'POWER', leftSign, rightSign);
      builder.emit(PlayerOp.SET_MOTORS);
      return;
    }
    case 'mbot_set_motors': {
      compilePowerInput(block, builder, 'LEFT');
      compilePowerInput(block, builder, 'RIGHT');
      builder.emit(PlayerOp.SET_MOTORS);
      return;
    }
    case 'mbot_stop_motors': {
      builder.emit(PlayerOp.STOP_MOTORS);
      return;
    }
    case 'mbot_wait': {
      compileWait(block, builder, 'SECONDS');
      return;
    }
    case 'mbot_set_led_named': {
      const which = ledTarget(block);
      const [r, g, b] = String(block.getFieldValue('COLOR') ?? '0,0,0')
        .split(',')
        .map((part) => clampInt(Number(part) || 0, 0, 255));
      builder.emit(PlayerOp.SET_RGB_LED);
      builder.emit(which);
      builder.emit(r);
      builder.emit(g);
      builder.emit(b);
      return;
    }
    case 'mbot_set_led_rgb': {
      const which = ledTarget(block);
      builder.emit(PlayerOp.SET_RGB_LED);
      builder.emit(which);
      for (const input of ['R', 'G', 'B']) {
        builder.emit(clampInt(requiredConstantNumber(block, input, `${input} must be a fixed number to store this LED block.`), 0, 255));
      }
      return;
    }
    case 'mbot_display_number': {
      builder.emit(PlayerOp.DISPLAY_NUMBER);
      builder.emitI16(requiredConstantNumber(block, 'VALUE', 'Display values must be fixed numbers to store this block.'));
      return;
    }
    case 'mbot_clear_display': {
      builder.emit(PlayerOp.CLEAR_DISPLAY);
      return;
    }
    case 'mbot_reset_timer': {
      builder.emit(PlayerOp.RESET_TIMER);
      return;
    }
    case 'mbot_repeat': {
      const times = clampInt(requiredConstantNumber(block, 'TIMES', 'Repeat counts must be fixed numbers to store this block.'), 0, 255);
      if (times === 0) return;
      const body = block.getInputTargetBlock('DO');
      for (let i = 0; i < times; i += 1) compileStatementChain(body, builder);
      return;
    }
    case 'mbot_forever': {
      const start = builder.offset;
      compileStatementChain(block.getInputTargetBlock('DO'), builder);
      builder.emit(PlayerOp.JUMP);
      builder.emitU16(start);
      return;
    }
    case 'mbot_repeat_until': {
      const start = builder.offset;
      compileExpression(block.getInputTargetBlock('CONDITION'), builder);
      const exit = builder.emitJump(PlayerOp.JUMP_IF_FALSE);
      const body = block.getInputTargetBlock('DO');
      builder.emit(PlayerOp.JUMP);
      const runBody = builder.offset;
      builder.emitU16(0);
      builder.patchU16(exit, builder.offset);
      compileStatementChain(body, builder);
      builder.emit(PlayerOp.JUMP);
      builder.emitU16(start);
      builder.patchU16(runBody, builder.offset);
      return;
    }
    case 'mbot_wait_until': {
      const start = builder.offset;
      compileExpression(block.getInputTargetBlock('CONDITION'), builder);
      const done = builder.emitJump(PlayerOp.JUMP_IF_FALSE);
      builder.emit(PlayerOp.JUMP);
      const success = builder.offset;
      builder.emitU16(0);
      builder.patchU16(done, start);
      builder.patchU16(success, builder.offset);
      return;
    }
    case 'controls_if': {
      compileIf(block, builder);
      return;
    }
    default:
      throw new BytecodeCompileError(`The "${block.type}" block cannot be stored on the robot yet.`, block);
  }
}

function compileIf(block: Blockly.Block, builder: Builder): void {
  const endPatches: number[] = [];
  let index = 0;
  while (block.getInput(`IF${index}`)) {
    compileExpression(block.getInputTargetBlock(`IF${index}`), builder);
    const falsePatch = builder.emitJump(PlayerOp.JUMP_IF_FALSE);
    compileStatementChain(block.getInputTargetBlock(`DO${index}`), builder);
    endPatches.push(builder.emitJump(PlayerOp.JUMP));
    builder.patchU16(falsePatch, builder.offset);
    index += 1;
  }
  compileStatementChain(block.getInputTargetBlock('ELSE'), builder);
  for (const patch of endPatches) builder.patchU16(patch, builder.offset);
}

function compileTimedMotion(block: Blockly.Block, builder: Builder, leftSign: number, rightSign: number): void {
  compilePowerPair(block, builder, 'POWER', leftSign, rightSign);
  builder.emit(PlayerOp.SET_MOTORS);
  compileWait(block, builder, 'SECONDS');
  builder.emit(PlayerOp.STOP_MOTORS);
}

function compilePowerPair(block: Blockly.Block, builder: Builder, input: string, leftSign: number, rightSign: number): void {
  compilePowerInput(block, builder, input, leftSign);
  compilePowerInput(block, builder, input, rightSign);
}

function compilePowerInput(block: Blockly.Block, builder: Builder, input: string, sign = 1): void {
  const constant = constantNumber(block.getInputTargetBlock(input));
  if (constant !== null) {
    builder.emit(PlayerOp.PUSH_I16);
    builder.emitI16(clampInt(Math.round(constant * 2.55 * sign), -255, 255));
    return;
  }
  compileExpression(block.getInputTargetBlock(input), builder);
  builder.emit(PlayerOp.POWER_TO_MOTOR);
  if (sign < 0) {
    builder.emit(PlayerOp.PUSH_I16);
    builder.emitI16(-1);
    builder.emit(PlayerOp.MUL);
  }
}

function compileWait(block: Blockly.Block, builder: Builder, input: string): void {
  const seconds = requiredConstantNumber(block, input, 'Wait times must be fixed numbers to store this block.');
  builder.emit(PlayerOp.WAIT_MS);
  builder.emitU16(clampInt(Math.round(seconds * 1000), 0, MAX_U16));
}

function compileExpression(block: Blockly.Block | null, builder: Builder): void {
  if (!block) {
    builder.emit(PlayerOp.PUSH_I16);
    builder.emitI16(0);
    return;
  }

  switch (block.type) {
    case 'math_number':
      builder.emit(PlayerOp.PUSH_I16);
      builder.emitI16(Math.round(Number(block.getFieldValue('NUM')) || 0));
      return;
    case 'logic_boolean':
      builder.emit(PlayerOp.PUSH_I16);
      builder.emitI16(block.getFieldValue('BOOL') === 'TRUE' ? 1 : 0);
      return;
    case 'math_arithmetic': {
      compileExpression(block.getInputTargetBlock('A'), builder);
      compileExpression(block.getInputTargetBlock('B'), builder);
      const op = String(block.getFieldValue('OP'));
      const opcode =
        op === 'MINUS' ? PlayerOp.SUB : op === 'MULTIPLY' ? PlayerOp.MUL : op === 'DIVIDE' ? PlayerOp.DIV : PlayerOp.ADD;
      builder.emit(opcode);
      return;
    }
    case 'math_round':
      compileExpression(block.getInputTargetBlock('NUM'), builder);
      return;
    case 'logic_compare': {
      compileExpression(block.getInputTargetBlock('A'), builder);
      compileExpression(block.getInputTargetBlock('B'), builder);
      const op = String(block.getFieldValue('OP'));
      if (op === 'GT') builder.emit(PlayerOp.GT);
      else if (op === 'EQ') builder.emit(PlayerOp.EQ);
      else if (op === 'NEQ') {
        builder.emit(PlayerOp.EQ);
        builder.emit(PlayerOp.NOT);
      } else if (op === 'LTE' || op === 'GTE') {
        throw new BytecodeCompileError(`The "${op}" comparison cannot be stored on the robot yet.`, block);
      } else {
        builder.emit(PlayerOp.LT);
      }
      return;
    }
    case 'logic_operation':
      compileExpression(block.getInputTargetBlock('A'), builder);
      compileExpression(block.getInputTargetBlock('B'), builder);
      builder.emit(block.getFieldValue('OP') === 'OR' ? PlayerOp.OR : PlayerOp.AND);
      return;
    case 'logic_negate':
      compileExpression(block.getInputTargetBlock('BOOL'), builder);
      builder.emit(PlayerOp.NOT);
      return;
    case 'mbot_ultrasonic':
      builder.emit(PlayerOp.READ_ULTRASONIC_CM);
      return;
    case 'mbot_obstacle_within':
      builder.emit(PlayerOp.READ_ULTRASONIC_CM);
      compileExpression(block.getInputTargetBlock('DISTANCE'), builder);
      builder.emit(PlayerOp.CM_WITHIN_OBSTACLE);
      return;
    case 'mbot_line_value':
      builder.emit(PlayerOp.READ_LINE_VALUE);
      return;
    case 'mbot_line_detects': {
      const side = block.getFieldValue('SIDE') === 'rightside' ? PlayerOp.READ_RIGHT_ON_LINE : PlayerOp.READ_LEFT_ON_LINE;
      builder.emit(side);
      if (block.getFieldValue('COLOR') === 'white') builder.emit(PlayerOp.NOT);
      return;
    }
    case 'mbot_left_on_line':
      builder.emit(PlayerOp.READ_LEFT_ON_LINE);
      return;
    case 'mbot_right_on_line':
      builder.emit(PlayerOp.READ_RIGHT_ON_LINE);
      return;
    case 'mbot_timer':
      builder.emit(PlayerOp.READ_TIMER_DSEC);
      return;
    default:
      throw new BytecodeCompileError(`The "${block.type}" value cannot be stored on the robot yet.`, block);
  }
}

function constantNumber(block: Blockly.Block | null): number | null {
  if (!block) return null;
  if (block.type !== 'math_number') return null;
  const value = Number(block.getFieldValue('NUM'));
  return Number.isFinite(value) ? value : null;
}

function requiredConstantNumber(block: Blockly.Block, input: string, message: string): number {
  const value = constantNumber(block.getInputTargetBlock(input));
  if (value === null) throw new BytecodeCompileError(message, block);
  return value;
}

function ledTarget(block: Blockly.Block): number {
  const which = block.getFieldValue('WHICH');
  return which === 'left' ? 2 : which === 'right' ? 1 : 0;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}
