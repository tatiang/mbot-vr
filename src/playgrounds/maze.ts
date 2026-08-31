import type { Arena, Obstacle, Vec2 } from '../types';
import { compassDegToHeading } from '../utils/units';
import { zone } from './helpers';

/**
 * Playground 4 - Maze.
 *
 * The layout is generated once, at module load, by a seeded depth-first search.
 * Building it that way rather than placing walls by hand guarantees the maze is
 * a spanning tree of the cell grid: every cell is reachable from every other, so
 * the finish can never be walled off, and the dead ends that make it worth
 * solving come for free. The seed is fixed, so every student sees the same maze.
 */

const COLS = 7;
const ROWS = 5;
/** Wall thickness in cm. */
const WALL = 6;
/** Cell pitch: corridor width plus one wall. */
const PITCH_X = 44;
const PITCH_Y = 42;
/** Corridors end up 38 x 36 cm - comfortably more than twice the chassis. */

const WIDTH = COLS * PITCH_X + WALL;
const HEIGHT = ROWS * PITCH_Y + WALL;

const MAZE_SEED = 0x5eed1234;

/** Deterministic PRNG, so the maze is identical in every browser and every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cell {
  /** Wall on this cell's right edge (shared with the cell to the east). */
  right: boolean;
  /** Wall on this cell's bottom edge (shared with the cell to the south). */
  bottom: boolean;
  visited: boolean;
}

function generateMaze(): Cell[][] {
  const random = mulberry32(MAZE_SEED);
  const grid: Cell[][] = [];
  for (let r = 0; r < ROWS; r += 1) {
    grid.push(
      Array.from({ length: COLS }, () => ({ right: true, bottom: true, visited: false })),
    );
  }

  // Iterative DFS from the start cell, carving as it goes.
  const stack: { c: number; r: number }[] = [{ c: 0, r: ROWS - 1 }];
  grid[ROWS - 1][0].visited = true;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbours: { c: number; r: number; dir: 'N' | 'S' | 'E' | 'W' }[] = [];

    if (current.r > 0 && !grid[current.r - 1][current.c].visited) {
      neighbours.push({ c: current.c, r: current.r - 1, dir: 'N' });
    }
    if (current.r < ROWS - 1 && !grid[current.r + 1][current.c].visited) {
      neighbours.push({ c: current.c, r: current.r + 1, dir: 'S' });
    }
    if (current.c < COLS - 1 && !grid[current.r][current.c + 1].visited) {
      neighbours.push({ c: current.c + 1, r: current.r, dir: 'E' });
    }
    if (current.c > 0 && !grid[current.r][current.c - 1].visited) {
      neighbours.push({ c: current.c - 1, r: current.r, dir: 'W' });
    }

    if (neighbours.length === 0) {
      stack.pop();
      continue;
    }

    const next = neighbours[Math.floor(random() * neighbours.length)];
    // Knock down the wall shared by the two cells.
    switch (next.dir) {
      case 'N':
        grid[next.r][next.c].bottom = false;
        break;
      case 'S':
        grid[current.r][current.c].bottom = false;
        break;
      case 'E':
        grid[current.r][current.c].right = false;
        break;
      case 'W':
        grid[next.r][next.c].right = false;
        break;
    }

    grid[next.r][next.c].visited = true;
    stack.push({ c: next.c, r: next.r });
  }

  return grid;
}

/** Turns the carved grid into the rectangles the physics and renderer use. */
function buildObstacles(grid: Cell[][]): Obstacle[] {
  const obstacles: Obstacle[] = [];
  let seq = 0;
  const add = (x: number, y: number, width: number, height: number) => {
    seq += 1;
    obstacles.push({ id: `maze${seq}`, kind: 'wall', x, y, width, height });
  };

  // Outer walls.
  add(0, 0, WIDTH, WALL);
  add(0, HEIGHT - WALL, WIDTH, WALL);
  add(0, 0, WALL, HEIGHT);
  add(WIDTH - WALL, 0, WALL, HEIGHT);

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = grid[r][c];
      // Interior walls only; the outer edges are already covered above.
      if (cell.right && c < COLS - 1) {
        add((c + 1) * PITCH_X, r * PITCH_Y, WALL, PITCH_Y + WALL);
      }
      if (cell.bottom && r < ROWS - 1) {
        add(c * PITCH_X, (r + 1) * PITCH_Y, PITCH_X + WALL, WALL);
      }
    }
  }

  return obstacles;
}

function cellCenter(c: number, r: number): Vec2 {
  return {
    x: c * PITCH_X + WALL + (PITCH_X - WALL) / 2,
    y: r * PITCH_Y + WALL + (PITCH_Y - WALL) / 2,
  };
}

const grid = generateMaze();
const start = cellCenter(0, ROWS - 1);
const finish = cellCenter(COLS - 1, 0);

export const maze: Arena = {
  id: 'maze',
  name: 'Maze',
  description:
    'Corridors and dead ends. Read the ultrasonic sensor to decide where to turn, and find the green finish in the far corner.',
  widthCm: WIDTH,
  heightCm: HEIGHT,
  gridCm: 0,
  start: { x: start.x, y: start.y, heading: compassDegToHeading(0) },
  obstacles: buildObstacles(grid),
  lines: [],
  zones: [
    zone(start.x - 14, start.y - 13, 28, 26, '#9aa7bd', 'Start'),
    zone(finish.x - 14, finish.y - 13, 28, 26, '#2fb774', 'Finish', true),
  ],
};

/** Exposed for tests: the centre of every maze cell. */
export const MAZE_CELL_CENTERS: Vec2[] = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => cellCenter(c, r)),
).flat();
