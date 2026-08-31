import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import { installGenerators } from './generators';

export interface CompileResult {
  /** Async function body ready to hand to the worker. */
  code: string;
  /** False when the workspace has no "when program starts" block. */
  hasStart: boolean;
  /** Number of blocks attached under the start block, for empty-program hints. */
  attachedBlocks: number;
  /** How many start blocks exist. More than one means the extras are ignored. */
  startBlockCount: number;
}

export const START_BLOCK_TYPE = 'mbot_when_start';

/**
 * Turns the workspace into runnable code.
 *
 * Only the stack under "when program starts" is compiled. Blocks left lying
 * around the workspace are ignored on purpose - students park half-finished
 * ideas off to the side all the time, and running them by accident is
 * confusing.
 */
export function compileWorkspace(
  workspace: Blockly.Workspace,
  options: { highlight: boolean } = { highlight: false },
): CompileResult {
  installGenerators();

  const startBlocks = workspace.getBlocksByType(START_BLOCK_TYPE, true);
  const startBlock = startBlocks[0];

  const previousPrefix = javascriptGenerator.STATEMENT_PREFIX;
  javascriptGenerator.STATEMENT_PREFIX = options.highlight ? 'robot.highlight(%1);\n' : '';

  try {
    javascriptGenerator.init(workspace);

    let body = '';
    let attachedBlocks = 0;
    if (startBlock) {
      const next = startBlock.getNextBlock();
      if (next) {
        attachedBlocks = next.getDescendants(false).length;
        const generated = javascriptGenerator.blockToCode(next);
        body = Array.isArray(generated) ? generated[0] : generated;
      }
    }

    const code = javascriptGenerator.finish(body);
    return {
      code,
      hasStart: Boolean(startBlock),
      attachedBlocks,
      startBlockCount: startBlocks.length,
    };
  } finally {
    javascriptGenerator.STATEMENT_PREFIX = previousPrefix;
  }
}

/**
 * Human-readable JavaScript for the read-only "JavaScript" tab.
 * Generated without the highlight instrumentation so students see their own
 * program rather than the runner's bookkeeping.
 */
export function previewJavaScript(workspace: Blockly.Workspace): string {
  const { code, hasStart } = compileWorkspace(workspace, { highlight: false });
  if (!hasStart) {
    return '// Add a "when program starts" block to see your JavaScript here.\n';
  }
  const body = code.trim();
  return `async function mbotProgram(robot) {\n${indent(body || '// (no blocks yet)')}\n}\n`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => (l.length ? `  ${l}` : l))
    .join('\n');
}
