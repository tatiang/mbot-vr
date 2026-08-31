import type { Arena } from '../types';
import { block, line, roomWalls, roundedRectPath, wall } from './helpers';

export interface FreeBuildLayout {
  id: string;
  name: string;
  description: string;
  /** Returns a new arena with this layout's obstacles/lines in place. */
  apply: (arena: Arena) => Arena;
}

/**
 * Starting points for the Free Build playground.
 *
 * These are not new playgrounds - they are content a student loads *into*
 * the editable Free Build arena and then keeps customising with the same
 * wall / box / line / erase tools. Each `apply` rebuilds its obstacles fresh
 * from the current arena's own dimensions, so it stays correct even if Free
 * Build's size ever changes, and replaces only obstacles/lines/zones -
 * dimensions, id, `editable` and whatever start position the student may
 * already have set are left untouched.
 */
export const FREE_BUILD_LAYOUTS: FreeBuildLayout[] = [
  {
    id: 'free-obstacle-field',
    name: 'Obstacle Field',
    description: 'A scattered field of boxes and a short wall - good ground for practising avoidance.',
    apply: (arena) => {
      const w = arena.widthCm;
      const h = arena.heightCm;
      return {
        ...arena,
        obstacles: [
          ...roomWalls(w, h),
          block(w * 0.3, h * 0.14, w * 0.08, h * 0.11),
          block(w * 0.56, h * 0.34, w * 0.09, h * 0.1),
          block(w * 0.74, h * 0.56, w * 0.08, h * 0.14),
          block(w * 0.2, h * 0.5, w * 0.07, h * 0.1),
          wall(w * 0.44, h * 0.5, w * 0.025, h * 0.28),
        ],
        lines: [],
        zones: [],
      };
    },
  },
  {
    id: 'free-practice-loop',
    name: 'Practice Loop',
    description: 'A rounded rectangle of black tape - a different shape to practise line following on.',
    apply: (arena) => {
      const w = arena.widthCm;
      const h = arena.heightCm;
      const margin = Math.min(w, h) * 0.16;
      const points = roundedRectPath(
        margin,
        margin,
        w - margin * 2,
        h - margin * 2,
        Math.min(w, h) * 0.18,
      );
      return {
        ...arena,
        obstacles: roomWalls(w, h),
        lines: [line(points, 4, true)],
        zones: [],
      };
    },
  },
];

export function freeBuildLayoutById(id: string): FreeBuildLayout | undefined {
  return FREE_BUILD_LAYOUTS.find((l) => l.id === id);
}
