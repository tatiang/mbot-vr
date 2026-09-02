interface Props {
  onStop: () => void;
  onAcknowledge: () => void;
}

/**
 * The one state the app is never allowed to dismiss on its own. Rendered only when
 * `DeviceSession`'s status is `stopUnconfirmed` - the halt ladder in
 * `StopController.ts` ran and never got a reply. See
 * `docs/hardware-bridge-plan.md` §9: "the words 'stopped' and the green state appear
 * only after a reply proves it."
 *
 * No timer clears this. It stays until either a later probe succeeds (the status
 * moves on by itself) or the student presses "I checked it" after physically looking
 * at the robot.
 */
export function StopBanner({ onStop, onAcknowledge }: Props) {
  return (
    <div className="stop-banner" role="alert">
      <strong>Your robot may still be moving.</strong>
      <span>Pick it up and switch it off if it doesn't stop on its own.</span>
      <div className="stop-banner__actions">
        <button type="button" className="btn btn--stop btn--sm" onClick={onStop}>
          Try Stop again
        </button>
        <button type="button" className="btn btn--sm" onClick={onAcknowledge}>
          I checked it
        </button>
      </div>
    </div>
  );
}
