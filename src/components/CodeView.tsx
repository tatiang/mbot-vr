/**
 * Read-only view of the JavaScript the blocks generate.
 *
 * A bridge for older students: it shows that the blocks are a real program, and
 * that `await` on every robot call is what lets the simulator run alongside it.
 * Editing is intentionally not offered - the blocks stay the source of truth.
 */
export function CodeView({ code }: { code: string }) {
  return (
    <pre className="code-view" tabIndex={0} aria-label="Generated JavaScript, read only">
      <code>
        <span className="code-view__note">
          {'// Read-only preview of your blocks as JavaScript.\n'}
          {'// Every robot command is awaited, which is how the simulator stays\n'}
          {'// responsive while your program runs.\n\n'}
        </span>
        {code}
      </code>
    </pre>
  );
}
