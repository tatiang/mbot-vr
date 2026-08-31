import type { Arena } from '../types';
import { gridWorld } from './gridWorld';
import { obstacleCourse } from './obstacleCourse';
import { lineFollowerCourse } from './lineFollower';
import { maze } from './maze';
import { freeBuild } from './freeBuild';
import { battleArena } from './battleArena';

export const PLAYGROUNDS: Arena[] = [
  gridWorld,
  obstacleCourse,
  lineFollowerCourse,
  maze,
  freeBuild,
  battleArena,
];

export const DEFAULT_PLAYGROUND_ID = gridWorld.id;

export function getPlayground(id: string): Arena {
  return PLAYGROUNDS.find((p) => p.id === id) ?? gridWorld;
}

/**
 * Arenas are shared module constants, so anything that mutates one (the Free
 * Build editor, an imported project) must work on a copy.
 */
export function cloneArena(arena: Arena): Arena {
  return {
    ...arena,
    start: { ...arena.start },
    obstacles: arena.obstacles.map((o) => ({ ...o })),
    lines: arena.lines.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
    zones: arena.zones.map((z) => ({ ...z })),
    ...(arena.opponent ? { opponent: { ...arena.opponent, start: { ...arena.opponent.start } } } : {}),
  };
}

export { gridWorld, obstacleCourse, lineFollowerCourse, maze, freeBuild, battleArena };
