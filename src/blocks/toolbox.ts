import type * as Blockly from 'blockly/core';
import { CATEGORY_COLORS } from './colors';

/** Shorthand for a number shadow block in a value socket. */
function num(value: number) {
  return { shadow: { type: 'math_number', fields: { NUM: value } } };
}

/**
 * The block palette.
 *
 * Categories follow the order students meet the ideas in: drive first, then
 * sense, then react. Advanced position/heading reporters sit in their own
 * sub-category so the Sensing list stays short for younger classes.
 */
export const TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Start',
      colour: CATEGORY_COLORS.events,
      contents: [{ kind: 'block', type: 'mbot_when_start' }],
    },
    {
      kind: 'category',
      name: 'Motion',
      colour: CATEGORY_COLORS.motion,
      contents: [
        // Timed blocks first: they are self-contained, so the first thing a
        // student drags out does something visible on its own.
        {
          kind: 'block',
          type: 'mbot_move_forward_for',
          inputs: { POWER: num(50), SECONDS: num(1) },
        },
        {
          kind: 'block',
          type: 'mbot_move_backward_for',
          inputs: { POWER: num(50), SECONDS: num(1) },
        },
        {
          kind: 'block',
          type: 'mbot_turn_left_for',
          inputs: { POWER: num(50), SECONDS: num(0.5) },
        },
        {
          kind: 'block',
          type: 'mbot_turn_right_for',
          inputs: { POWER: num(50), SECONDS: num(0.5) },
        },
        { kind: 'sep', gap: '16' },
        { kind: 'label', text: 'Keep going until told to stop' },
        { kind: 'block', type: 'mbot_move_direction', inputs: { POWER: num(50) } },
        { kind: 'block', type: 'mbot_set_motors', inputs: { LEFT: num(50), RIGHT: num(50) } },
        { kind: 'block', type: 'mbot_stop_motors' },
      ],
    },
    {
      kind: 'category',
      name: 'Sensing',
      colour: CATEGORY_COLORS.sensing,
      contents: [
        { kind: 'block', type: 'mbot_ultrasonic' },
        { kind: 'block', type: 'mbot_obstacle_within', inputs: { DISTANCE: num(20) } },
        { kind: 'block', type: 'mbot_left_on_line' },
        { kind: 'block', type: 'mbot_right_on_line' },
        { kind: 'block', type: 'mbot_line_detects' },
        { kind: 'block', type: 'mbot_line_value' },
        { kind: 'block', type: 'mbot_timer' },
        { kind: 'block', type: 'mbot_reset_timer' },
        { kind: 'label', text: 'Advanced' },
        { kind: 'block', type: 'mbot_robot_x' },
        { kind: 'block', type: 'mbot_robot_y' },
        { kind: 'block', type: 'mbot_robot_heading' },
      ],
    },
    {
      kind: 'category',
      name: 'Looks',
      colour: CATEGORY_COLORS.looks,
      contents: [
        { kind: 'block', type: 'mbot_set_led_named' },
        {
          kind: 'block',
          type: 'mbot_set_led_rgb',
          inputs: { R: num(0), G: num(180), B: num(255) },
        },
        { kind: 'block', type: 'mbot_display_number', inputs: { VALUE: num(0) } },
        { kind: 'block', type: 'mbot_clear_display' },
      ],
    },
    {
      kind: 'category',
      name: 'Control',
      colour: CATEGORY_COLORS.control,
      contents: [
        { kind: 'block', type: 'mbot_wait', inputs: { SECONDS: num(1) } },
        { kind: 'block', type: 'mbot_repeat', inputs: { TIMES: num(4) } },
        { kind: 'block', type: 'mbot_forever' },
        { kind: 'block', type: 'controls_if' },
        {
          kind: 'block',
          type: 'controls_if',
          extraState: { hasElse: true },
        },
        {
          kind: 'block',
          type: 'controls_if',
          extraState: { elseIfCount: 1, hasElse: true },
        },
        { kind: 'block', type: 'mbot_repeat_until' },
        { kind: 'block', type: 'mbot_wait_until' },
      ],
    },
    {
      kind: 'category',
      name: 'Operators',
      colour: CATEGORY_COLORS.operators,
      contents: [
        {
          kind: 'block',
          type: 'logic_compare',
          fields: { OP: 'LT' },
          inputs: { A: num(0), B: num(20) },
        },
        {
          kind: 'block',
          type: 'logic_compare',
          fields: { OP: 'GT' },
          inputs: { A: num(0), B: num(20) },
        },
        {
          kind: 'block',
          type: 'logic_compare',
          fields: { OP: 'EQ' },
          inputs: { A: num(0), B: num(0) },
        },
        { kind: 'block', type: 'logic_operation', fields: { OP: 'AND' } },
        { kind: 'block', type: 'logic_operation', fields: { OP: 'OR' } },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'sep', gap: '12' },
        {
          kind: 'block',
          type: 'math_arithmetic',
          fields: { OP: 'ADD' },
          inputs: { A: num(1), B: num(1) },
        },
        {
          kind: 'block',
          type: 'math_arithmetic',
          fields: { OP: 'MINUS' },
          inputs: { A: num(1), B: num(1) },
        },
        {
          kind: 'block',
          type: 'math_arithmetic',
          fields: { OP: 'MULTIPLY' },
          inputs: { A: num(2), B: num(2) },
        },
        {
          kind: 'block',
          type: 'math_arithmetic',
          fields: { OP: 'DIVIDE' },
          inputs: { A: num(10), B: num(2) },
        },
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
        {
          kind: 'block',
          type: 'math_random_int',
          inputs: { FROM: num(1), TO: num(100) },
        },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      colour: CATEGORY_COLORS.variables,
      custom: 'VARIABLE',
    },
  ],
};
