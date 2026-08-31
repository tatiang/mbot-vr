import type { ChallengeStats } from './ChallengeTracker';

export interface Challenge {
  id: string;
  playgroundId: string;
  title: string;
  /** Student-facing goal, one or two short sentences. */
  goal: string;
  /** Concrete steps or hints shown under the goal. */
  hints: string[];
  /** Live progress line, e.g. "2 of 4 targets". */
  progress: (stats: ChallengeStats) => string;
  /** True once the goal has been met during the current run. */
  isComplete: (stats: ChallengeStats) => boolean;
  /** True when the attempt can no longer succeed; shows a gentle retry note. */
  isFailed?: (stats: ChallengeStats) => boolean;
  failMessage?: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'grid-square',
    playgroundId: 'grid',
    title: 'Drive a Square',
    goal: 'Drive away from the start square, make four 90 degree turns, and come back to where you started.',
    hints: [
      'Use a repeat 4 block.',
      'Inside it: move forward, wait, turn, wait.',
      'Change the wait time after the turn until each corner is square.',
    ],
    progress: (s) =>
      s.returnedToStart
        ? 'Back at the start.'
        : `Furthest from start: ${Math.round(s.maxDistanceFromStartCm)} cm`,
    isComplete: (s) => s.returnedToStart,
  },
  {
    id: 'grid-targets',
    playgroundId: 'grid',
    title: 'Visit Every Target',
    goal: 'Drive over the blue, green and orange squares in any order.',
    hints: [
      'Plan the trip on paper first.',
      'Break it into "forward, turn, forward" steps.',
      'The grid squares are 20 cm across.',
    ],
    progress: (s) => `${s.visitedGoalZones.length} of 3 targets reached`,
    isComplete: (s) => s.visitedGoalZones.length >= 3,
  },
  {
    id: 'obstacles-nocrash',
    playgroundId: 'obstacles',
    title: "Don't Crash",
    goal: 'Keep driving for 30 seconds without bumping into anything.',
    hints: [
      'Put your logic inside a forever loop.',
      'Check "ultrasonic distance < 20" before driving forward.',
      'Remember that 0 means nothing is in range, so it is safe to drive.',
    ],
    progress: (s) =>
      `${Math.floor(s.elapsed)} s driven, ${s.collisions} bump${s.collisions === 1 ? '' : 's'}`,
    isComplete: (s) => s.elapsed >= 30 && s.collisions === 0,
    isFailed: (s) => s.collisions > 0,
    failMessage: 'You bumped something. Press Reset and try a bigger safety distance.',
  },
  {
    id: 'line-lap',
    playgroundId: 'line',
    title: 'Follow the Loop',
    goal: 'Complete one full lap of the black line without losing it for more than 2 seconds.',
    hints: [
      'Use if / else with the line sensor blocks.',
      'When only one sensor is on the line, slow that side down to steer back.',
      'When both sensors are off the line, turn until you find it again.',
    ],
    progress: (s) => `Lap progress: ${Math.round(s.lapProgress * 100)}%  (laps: ${s.laps})`,
    isComplete: (s) => s.laps >= 1,
    isFailed: (s) => s.longestOffLineSeconds > 2,
    failMessage: 'The robot lost the line for too long. Press Reset and adjust your turn speeds.',
  },
  {
    id: 'maze-escape',
    playgroundId: 'maze',
    title: 'Escape the Maze',
    goal: 'Reach the green finish zone in the top-right corner.',
    hints: [
      'Try a wall-following rule: keep turning the same way whenever you can.',
      'Use the ultrasonic sensor to decide when the way ahead is blocked.',
      'Watch the sensor monitor to see what the robot sees at each junction.',
    ],
    progress: (s) => (s.visitedGoalZones.length > 0 ? 'Finish reached!' : 'Still exploring...'),
    isComplete: (s) => s.visitedGoalZones.length > 0,
  },
  {
    id: 'battle-survive',
    playgroundId: 'battle',
    title: 'Hold the Ring',
    goal: 'Stay in the arena for 45 seconds while the other robot chases you.',
    hints: [
      'The ultrasonic sensor sees the other robot too.',
      'Drive away when it gets close, then come back.',
      'This playground is experimental - expect rough edges.',
    ],
    progress: (s) => `${Math.floor(s.elapsed)} s survived`,
    isComplete: (s) => s.elapsed >= 45,
  },
];

export function challengesFor(playgroundId: string): Challenge[] {
  return CHALLENGES.filter((c) => c.playgroundId === playgroundId);
}

export type { ChallengeStats };
