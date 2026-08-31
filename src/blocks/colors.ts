/**
 * Block category colours.
 *
 * Chosen to echo mBlock's own category colour scheme (so the palette feels
 * familiar to students moving between the two tools) while still passing
 * WCAG AA contrast against white block text - category names are always
 * shown as well, never colour alone, for colour-blind readers.
 */
export const CATEGORY_COLORS = {
  events: '#9E6C0E',
  motion: '#3568C4',
  sensing: '#1880A0',
  looks: '#7C4FD1',
  control: '#AB6619',
  operators: '#2A864F',
  variables: '#C2561D',
} as const;

export type CategoryName = keyof typeof CATEGORY_COLORS;
