import * as Blockly from 'blockly/core';
import { javascriptGenerator, Order } from 'blockly/javascript';

/**
 * JavaScript generators for the mBot blocks.
 *
 * Everything the robot does is asynchronous, so every statement is `await`ed
 * and the whole program is later executed as the body of an async function.
 * That is what makes Stop instant and infinite loops harmless: the program
 * spends its life suspended on a promise rather than hogging a thread.
 */

let installed = false;

export function installGenerators(): void {
  if (installed) return;
  installed = true;

  // The generated program receives exactly one binding; make sure Blockly never
  // names a student variable `robot` and shadows it.
  javascriptGenerator.addReservedWords('robot,await,async');

  // Injected at the top of every loop body. Without it an empty `forever`
  // would be a tight spin inside the worker.
  javascriptGenerator.INFINITE_LOOP_TRAP = 'await robot.yield();\n';

  const g = javascriptGenerator.forBlock;

  // --- Events -------------------------------------------------------------
  g['mbot_when_start'] = () => '';

  // --- Motion -------------------------------------------------------------
  //
  // Block faces show power as a 0-100% figure, matching mBlock; the engine's
  // motor API still runs on the real -255..255 register range underneath (see
  // RobotPhysics.ts and DifferentialDrive.ts), so every percent value is
  // scaled at the point it becomes a motor call. See `pct` below for the
  // exact factor and why.
  g['mbot_move_forward_for'] = (block) => {
    const power = pct(value(block, 'POWER', '0'));
    return timedMotion(block, power, power);
  };

  g['mbot_move_backward_for'] = (block) => {
    const power = pct(value(block, 'POWER', '0'));
    return timedMotion(block, `-(${power})`, `-(${power})`);
  };

  g['mbot_turn_left_for'] = (block) => {
    const power = pct(value(block, 'POWER', '0'));
    return timedMotion(block, `-(${power})`, power);
  };

  g['mbot_turn_right_for'] = (block) => {
    const power = pct(value(block, 'POWER', '0'));
    return timedMotion(block, power, `-(${power})`);
  };

  g['mbot_move_direction'] = (block) => {
    const direction = block.getFieldValue('DIRECTION') as 'forward' | 'backward' | 'left' | 'right';
    const power = pct(value(block, 'POWER', '0'));
    switch (direction) {
      case 'backward':
        return `await robot.setMotors(-(${power}), -(${power}));\n`;
      case 'left':
        return `await robot.setMotors(-(${power}), ${power});\n`;
      case 'right':
        return `await robot.setMotors(${power}, -(${power}));\n`;
      case 'forward':
      default:
        return `await robot.setMotors(${power}, ${power});\n`;
    }
  };

  g['mbot_set_motors'] = (block) => {
    const left = pct(value(block, 'LEFT', '0'));
    const right = pct(value(block, 'RIGHT', '0'));
    return `await robot.setMotors(${left}, ${right});\n`;
  };

  g['mbot_stop_motors'] = () => 'await robot.stop();\n';

  // --- Sensing ------------------------------------------------------------
  g['mbot_ultrasonic'] = () => ['(await robot.getUltrasonicDistance())', Order.ATOMIC];
  g['mbot_obstacle_within'] = (block) => {
    const distance = value(block, 'DISTANCE', '0');
    // An async IIFE lets a single ultrasonic reading back both halves of the
    // test (something is there, and it is close enough), rather than reading
    // the sensor twice - which could see two different values a frame apart.
    const code =
      '(await (async () => { ' +
      'const d = await robot.getUltrasonicDistance(); ' +
      `return d > 0 && d < (${distance}); ` +
      '})())';
    return [code, Order.ATOMIC];
  };
  g['mbot_line_value'] = () => ['(await robot.getLineFollowerValue())', Order.ATOMIC];
  g['mbot_line_detects'] = (block) => {
    const side = block.getFieldValue('SIDE') as 'leftside' | 'rightside';
    const color = block.getFieldValue('COLOR') as 'black' | 'white';
    const call = side === 'leftside' ? 'isLeftLineSensorOnLine' : 'isRightLineSensorOnLine';
    // "black" means on the tape (the sensor's normal reading); "white" is its
    // opposite, matching how a real photoresistor-based module would report
    // whichever colour it was told to watch for.
    const code = color === 'white' ? `(!(await robot.${call}()))` : `(await robot.${call}())`;
    return [code, Order.ATOMIC];
  };
  g['mbot_left_on_line'] = () => ['(await robot.isLeftLineSensorOnLine())', Order.ATOMIC];
  g['mbot_right_on_line'] = () => ['(await robot.isRightLineSensorOnLine())', Order.ATOMIC];
  g['mbot_robot_x'] = () => ['(await robot.getX())', Order.ATOMIC];
  g['mbot_robot_y'] = () => ['(await robot.getY())', Order.ATOMIC];
  g['mbot_robot_heading'] = () => ['(await robot.getHeading())', Order.ATOMIC];
  g['mbot_timer'] = () => ['(await robot.getTimer())', Order.ATOMIC];
  g['mbot_reset_timer'] = () => 'await robot.resetTimer();\n';

  // --- Looks --------------------------------------------------------------
  g['mbot_set_led_named'] = (block) => {
    const which = block.getFieldValue('WHICH') as string;
    const [r, gr, b] = String(block.getFieldValue('COLOR')).split(',');
    return `await robot.setRgbLed(${JSON.stringify(which)}, ${r}, ${gr}, ${b});\n`;
  };

  g['mbot_set_led_rgb'] = (block) => {
    const which = block.getFieldValue('WHICH') as string;
    const r = value(block, 'R', '0');
    const gr = value(block, 'G', '0');
    const b = value(block, 'B', '0');
    return `await robot.setRgbLed(${JSON.stringify(which)}, ${r}, ${gr}, ${b});\n`;
  };

  g['mbot_display_number'] = (block) => {
    const v = value(block, 'VALUE', '0');
    return `await robot.displayNumber(${v});\n`;
  };

  g['mbot_clear_display'] = () => "await robot.displayNumber('');\n";

  // --- Control ------------------------------------------------------------
  g['mbot_wait'] = (block) => {
    const seconds = value(block, 'SECONDS', '0');
    return `await robot.wait(${seconds});\n`;
  };

  g['mbot_repeat'] = (block) => {
    const times = value(block, 'TIMES', '0');
    // No yield trap here: a counted loop always terminates, so it cannot spin.
    // Leaving it out also keeps the loop from spending a simulation frame per
    // iteration, which is what makes "repeat 4: forward, wait, turn, wait"
    // trace an accurate square.
    const branch = javascriptGenerator.statementToCode(block, 'DO');
    // A dedicated counter name per block keeps nested repeats independent.
    const counter = javascriptGenerator.nameDB_!.getDistinctName(
      'count',
      Blockly.Names.NameType.VARIABLE,
    );
    const limit = javascriptGenerator.nameDB_!.getDistinctName(
      'repeatEnd',
      Blockly.Names.NameType.VARIABLE,
    );
    return (
      `var ${limit} = Math.max(0, Math.floor(Number(${times}) || 0));\n` +
      `for (var ${counter} = 0; ${counter} < ${limit}; ${counter}++) {\n${branch}}\n`
    );
  };

  g['mbot_forever'] = (block) => {
    const branch = loopBody(block, 'DO');
    return `while (true) {\n${branch}}\n`;
  };

  g['mbot_repeat_until'] = (block) => {
    const condition = javascriptGenerator.valueToCode(block, 'CONDITION', Order.NONE) || 'false';
    const branch = loopBody(block, 'DO');
    return `while (!(${condition})) {\n${branch}}\n`;
  };

  g['mbot_wait_until'] = (block) => {
    const condition = javascriptGenerator.valueToCode(block, 'CONDITION', Order.NONE) || 'false';
    return `while (!(${condition})) {\n  await robot.yield();\n}\n`;
  };
}

/**
 * Drive / wait / stop, the body of every timed motion block.
 *
 * Stopping at the end is what makes these blocks self-contained: a sequence
 * built from them leaves the robot stationary, so the student never has to
 * remember a trailing `stop moving`. The engine freezes simulated time between
 * the motor command and the wait, so the elapsed time is exactly what the block
 * says.
 */
function timedMotion(block: Blockly.Block, left: string, right: string): string {
  const seconds = value(block, 'SECONDS', '0');
  return (
    `await robot.setMotors(${left}, ${right});\n` +
    `await robot.wait(${seconds});\n` +
    'await robot.stop();\n'
  );
}

/** Reads a value input, falling back to a literal when the socket is empty. */
function value(block: Blockly.Block, name: string, fallback: string): string {
  return javascriptGenerator.valueToCode(block, name, Order.NONE) || fallback;
}

/**
 * Converts a block-facing power percentage into the runtime's -255..255
 * motor scale: 100% -> 255, 0% -> 0. The runtime clamps and rounds the
 * result, so this only needs to get the scale right, not the precision.
 */
function pct(expr: string): string {
  return `(${expr}) * 2.55`;
}

/**
 * Statement body of an unbounded loop, with the yield trap prepended.
 *
 * The trap is what lets one simulation frame pass per iteration, so a `forever`
 * control loop runs at the frame rate instead of spinning, and the Stop button
 * is never waiting on a busy worker.
 */
function loopBody(block: Blockly.Block, name: string): string {
  const branch = javascriptGenerator.statementToCode(block, name);
  return javascriptGenerator.addLoopTrap(branch, block);
}
