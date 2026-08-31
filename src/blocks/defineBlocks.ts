import * as Blockly from 'blockly/core';
import { CATEGORY_COLORS } from './colors';

/**
 * Custom mBot block definitions.
 *
 * The vocabulary deliberately mirrors the mBlock blocks a student would use on
 * a physical mBot - same motor range, same line-follower values - so a program
 * built here reads the same as one built for the real robot.
 */

/** Marks a block as a "hat" so the start block reads as the top of a program. */
Blockly.Extensions.register('mbot_start_hat', function (this: Blockly.Block) {
  (this as Blockly.BlockSvg).hat = 'cap';
});

/** Matches the dropdown on mBlock's own continuous-motion Action block. */
const DIRECTION_OPTIONS: Blockly.MenuOption[] = [
  ['move forward', 'forward'],
  ['move backward', 'backward'],
  ['turn left', 'left'],
  ['turn right', 'right'],
];

const LINE_SIDE_OPTIONS: Blockly.MenuOption[] = [
  ['leftside', 'leftside'],
  ['rightside', 'rightside'],
];

const LINE_COLOR_OPTIONS: Blockly.MenuOption[] = [
  ['black', 'black'],
  ['white', 'white'],
];

const LED_TARGETS: Blockly.MenuOption[] = [
  ['both LEDs', 'all'],
  ['left LED', 'left'],
  ['right LED', 'right'],
];

/** Named colours instead of a colour wheel: quicker to pick, easier to read aloud. */
const LED_COLORS: Blockly.MenuOption[] = [
  ['red', '255,0,0'],
  ['orange', '255,110,0'],
  ['yellow', '255,220,0'],
  ['green', '0,200,60'],
  ['cyan', '0,200,220'],
  ['blue', '0,80,255'],
  ['purple', '150,0,220'],
  ['white', '255,255,255'],
  ['off', '0,0,0'],
];

const BLOCK_DEFINITIONS: Blockly.utils.toolbox.BlockInfo[] | object[] = [
  // --- Events -------------------------------------------------------------
  {
    type: 'mbot_when_start',
    message0: 'when program starts',
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
    extensions: ['mbot_start_hat'],
    tooltip: 'Everything joined underneath this block runs when you press Run.',
    helpUrl: '',
  },

  // --- Motion -------------------------------------------------------------
  //
  // Wording and units deliberately mirror mBlock's own Action blocks (drag a
  // real mBot into mBlock and this is what you see): motor strength is a
  // "power" percentage from 0-100, not a raw -255..255 register value. The
  // simulator still drives its physics on the real -255..255 scale
  // internally - the generators in generators.ts convert at the boundary -
  // so a program built here reads exactly like one built for the physical
  // robot, block for block.
  //
  // Two families. The timed ones run for a set time and then stop, which
  // makes them self-contained and is what a student wants when writing a
  // sequence. The continuous one sets the motors and leaves them running,
  // which is what a control loop wants; the timed blocks simply bundle the
  // `wait` and `stop moving` that would otherwise have to follow every move.
  {
    type: 'mbot_move_forward_for',
    message0: 'move forward at power %1%% for %2 seconds',
    args0: [
      { type: 'input_value', name: 'POWER', check: 'Number' },
      { type: 'input_value', name: 'SECONDS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip: 'Drives both wheels forward for a set time, then stops. Power goes from 0 to 100%.',
  },
  {
    type: 'mbot_move_backward_for',
    message0: 'move backward at power %1%% for %2 seconds',
    args0: [
      { type: 'input_value', name: 'POWER', check: 'Number' },
      { type: 'input_value', name: 'SECONDS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip: 'Drives both wheels backward for a set time, then stops.',
  },
  {
    type: 'mbot_turn_left_for',
    message0: 'turn left at power %1%% for %2 seconds',
    args0: [
      { type: 'input_value', name: 'POWER', check: 'Number' },
      { type: 'input_value', name: 'SECONDS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip:
      'Spins left on the spot for a set time, then stops. Change the time to change the angle.',
  },
  {
    type: 'mbot_turn_right_for',
    message0: 'turn right at power %1%% for %2 seconds',
    args0: [
      { type: 'input_value', name: 'POWER', check: 'Number' },
      { type: 'input_value', name: 'SECONDS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip:
      'Spins right on the spot for a set time, then stops. Change the time to change the angle.',
  },
  {
    type: 'mbot_move_direction',
    message0: '%1 at power %2%%',
    args0: [
      { type: 'field_dropdown', name: 'DIRECTION', options: DIRECTION_OPTIONS },
      { type: 'input_value', name: 'POWER', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip:
      'Sets the motors for the chosen direction and leaves them running until something else changes them. Use this inside a forever loop; use the "for ... seconds" blocks for a single step.',
  },
  {
    type: 'mbot_set_motors',
    message0: 'left wheel turns at power %1%%, right wheel at power %2%%',
    args0: [
      { type: 'input_value', name: 'LEFT', check: 'Number' },
      { type: 'input_value', name: 'RIGHT', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.motion,
    tooltip:
      'Sets each wheel separately, from -100 to 100%. Different speeds make the robot curve; opposite speeds make it spin.',
  },
  {
    type: 'mbot_stop_motors',
    message0: 'stop moving',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
    tooltip: 'Sets both motors to 0. The robot coasts to a stop where it is.',
  },

  // --- Sensing ------------------------------------------------------------
  //
  // mBlock's real sensing blocks include a port dropdown on most of these
  // (a physical mCore board has several numbered ports you can plug an
  // add-on sensor into). The simulated mBot has exactly one of each sensor
  // wired in a fixed place, so the port picker is dropped - there is nothing
  // for it to choose between - while the wording otherwise matches.
  {
    type: 'mbot_ultrasonic',
    message0: 'ultrasonic sensor distance (cm)',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'How far away the nearest object is, in centimetres. Reports 0 when nothing is in range.',
  },
  {
    type: 'mbot_obstacle_within',
    message0: 'is something closer than %1 cm?',
    args0: [{ type: 'input_value', name: 'DISTANCE', check: 'Number' }],
    output: 'Boolean',
    inputsInline: true,
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'True when the ultrasonic sensor sees an object closer than this distance. Already handles the case where nothing is in range, so you do not need a separate "distance > 0" check. (An mBot VR shortcut - there is no single block like this in mBlock.)',
  },
  {
    type: 'mbot_line_value',
    message0: 'line follower sensor value',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      '0 = both sensors on the line, 1 = only left on, 2 = only right on, 3 = both off the line.',
  },
  {
    type: 'mbot_line_detects',
    message0: 'line follower sensor detects %1 being %2 ?',
    args0: [
      { type: 'field_dropdown', name: 'SIDE', options: LINE_SIDE_OPTIONS },
      { type: 'field_dropdown', name: 'COLOR', options: LINE_COLOR_OPTIONS },
    ],
    output: 'Boolean',
    inputsInline: true,
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'Matches mBlock\'s line-follower block. mBot VR\'s course is always a dark line on a light floor, so "black" means that sensor is over the tape and "white" means it is off the tape.',
  },
  {
    type: 'mbot_left_on_line',
    message0: 'left line sensor on line?',
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'True when the left sensor can see the black line. A friendlier shortcut for "line follower sensor detects leftside being black".',
  },
  {
    type: 'mbot_right_on_line',
    message0: 'right line sensor on line?',
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'True when the right sensor can see the black line. A friendlier shortcut for "line follower sensor detects rightside being black".',
  },
  {
    type: 'mbot_robot_x',
    message0: 'robot x position',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip:
      'Distance in centimetres from the left wall of the playground. An mBot VR-only block - a real mBot has no way to sense this without extra hardware.',
  },
  {
    type: 'mbot_robot_y',
    message0: 'robot y position',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip: 'Distance in centimetres from the top wall of the playground. mBot VR-only.',
  },
  {
    type: 'mbot_robot_heading',
    message0: 'robot heading',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip: 'Which way the robot faces, in degrees. 0 is up, 90 is right. mBot VR-only.',
  },
  {
    type: 'mbot_timer',
    message0: 'timer',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip: 'Seconds since the program started running, or since the last "reset timer".',
  },
  {
    type: 'mbot_reset_timer',
    message0: 'reset timer',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sensing,
    tooltip: 'Sets the timer back to 0, without changing the robot\'s position, motors or display.',
  },

  // --- Looks --------------------------------------------------------------
  {
    type: 'mbot_set_led_named',
    message0: 'set %1 to %2',
    args0: [
      { type: 'field_dropdown', name: 'WHICH', options: LED_TARGETS },
      { type: 'field_dropdown', name: 'COLOR', options: LED_COLORS },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.looks,
    tooltip: 'Lights up the RGB LEDs on top of the robot.',
  },
  {
    type: 'mbot_set_led_rgb',
    message0: 'set %1 to R %2 G %3 B %4',
    args0: [
      { type: 'field_dropdown', name: 'WHICH', options: LED_TARGETS },
      { type: 'input_value', name: 'R', check: 'Number' },
      { type: 'input_value', name: 'G', check: 'Number' },
      { type: 'input_value', name: 'B', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.looks,
    tooltip: 'Mixes your own LED colour. Each of red, green and blue goes from 0 to 255.',
  },
  {
    type: 'mbot_display_number',
    message0: 'display number %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.looks,
    tooltip:
      'Shows a number on the four-digit display. Numbers above 9999 or below -999 show as ----.',
  },
  {
    type: 'mbot_clear_display',
    message0: 'clear display',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: 'Blanks the four-digit display.',
  },

  // --- Control ------------------------------------------------------------
  {
    type: 'mbot_wait',
    message0: 'wait %1 seconds',
    args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.control,
    tooltip: 'Pauses here. The motors keep doing whatever you last told them to do.',
  },
  {
    type: 'mbot_repeat',
    message0: 'repeat %1',
    args0: [{ type: 'input_value', name: 'TIMES', check: 'Number' }],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.control,
    tooltip: 'Runs the blocks inside a fixed number of times.',
  },
  {
    type: 'mbot_forever',
    message0: 'forever',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    colour: CATEGORY_COLORS.control,
    tooltip: 'Runs the blocks inside over and over until you press Stop.',
  },
  {
    type: 'mbot_repeat_until',
    message0: 'repeat until %1',
    args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.control,
    tooltip: 'Keeps running the blocks inside until the test becomes true.',
  },
  {
    type: 'mbot_wait_until',
    message0: 'wait until %1',
    args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    colour: CATEGORY_COLORS.control,
    tooltip: 'Pauses here until the test becomes true.',
  },
];

let defined = false;

/** Registers every custom block. Safe to call more than once. */
export function defineMbotBlocks(): void {
  if (defined) return;
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS as object[]);
  recolorBuiltinBlocks();
  defined = true;
}

/**
 * Repaints the built-in logic/math/variable blocks so they match the mBot
 * categories instead of Blockly's stock palette.
 */
function recolorBuiltinBlocks(): void {
  const recolor: Record<string, string> = {
    controls_if: CATEGORY_COLORS.control,
    logic_compare: CATEGORY_COLORS.operators,
    logic_operation: CATEGORY_COLORS.operators,
    logic_negate: CATEGORY_COLORS.operators,
    logic_boolean: CATEGORY_COLORS.operators,
    math_number: CATEGORY_COLORS.operators,
    math_arithmetic: CATEGORY_COLORS.operators,
    math_random_int: CATEGORY_COLORS.operators,
    math_round: CATEGORY_COLORS.operators,
    variables_get: CATEGORY_COLORS.variables,
    variables_set: CATEGORY_COLORS.variables,
    math_change: CATEGORY_COLORS.variables,
  };

  for (const [type, colour] of Object.entries(recolor)) {
    const definition = Blockly.Blocks[type];
    if (!definition) continue;
    const originalInit = definition.init;
    definition.init = function (this: Blockly.Block) {
      originalInit.call(this);
      this.setColour(colour);
    };
  }
}

export { LED_COLORS, LED_TARGETS };
