import { useState } from 'react';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import { challengesFor } from '../challenges';
import { useEngineSample } from '../hooks/useEngineSample';

/**
 * Challenge instructions and live progress for the current playground.
 *
 * Progress is descriptive rather than scored: at this level the useful feedback
 * is "you have visited 2 of 3 targets", not a point total.
 */
export function ChallengePanel({
  engine,
  playgroundId,
}: {
  engine: SimulationEngine;
  playgroundId: string;
}) {
  const challenges = challengesFor(playgroundId);
  const [index, setIndex] = useState(0);
  const stats = useEngineSample(engine, (e) => e.challenges.stats, 5);

  if (challenges.length === 0) {
    return (
      <p className="list__empty">
        This playground has no challenges - it is a free space to experiment in.
      </p>
    );
  }

  const safeIndex = Math.min(index, challenges.length - 1);
  const challenge = challenges[safeIndex];
  const complete = challenge.isComplete(stats);
  const failed = !complete && Boolean(challenge.isFailed?.(stats));

  return (
    <div className="challenge">
      {challenges.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Challenges">
          {challenges.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={i === safeIndex}
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <h3 style={{ margin: '8px 0 0', fontSize: 15 }}>{challenge.title}</h3>
      <p className="challenge__goal">{challenge.goal}</p>
      <p className="challenge__progress">{challenge.progress(stats)}</p>

      {complete && (
        <p className="challenge__status challenge__status--done">Challenge complete. Nice work!</p>
      )}
      {failed && (
        <p className="challenge__status challenge__status--failed">
          {challenge.failMessage ?? 'Not quite - press Reset and try again.'}
        </p>
      )}

      <ul className="challenge__hints">
        {challenge.hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </div>
  );
}
