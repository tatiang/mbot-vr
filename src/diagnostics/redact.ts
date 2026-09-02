/**
 * Redaction for anything that reaches the diagnostic log.
 *
 * This is defense in depth, not the primary mechanism: the actual guarantee that a
 * student's project names, block names or variable names never appear in the log is
 * that the device and diagnostics layers never pass that text into a logged message in
 * the first place - `DeviceSession`, `StopController` and `preflight.ts` only ever log
 * developer-authored strings (taxonomy messages, protocol byte counts, fixed block-type
 * identifiers like `mbot_robot_x`). What `redact()` catches is the harder-to-avoid
 * case: a raw `Error.message` or stack trace from the browser or from a serial API
 * call, which can legitimately contain a filesystem path, a device path, or something
 * that looks like a token. See `docs/hardware-bridge-plan.md` §11.
 *
 * Runs at *write* time (`DiagnosticLog.log()` calls this before an event is stored),
 * not at export time, so a code path that forgets to redact on the way out cannot leak
 * anything - there is nothing unredacted in the buffer to forget to scrub.
 */

type Replacer = (substring: string, ...rest: unknown[]) => string;

const RULES: Array<{ pattern: RegExp; replace: Replacer }> = [
  // macOS/Linux home directories: /Users/tatiang/... or /home/tatiang/...
  { pattern: /\/Users\/[^/\s]+/gi, replace: () => '/Users/<user>' },
  { pattern: /\/home\/[^/\s]+/gi, replace: () => '/home/<user>' },
  // Windows home directories: C:\Users\tatiang\...
  { pattern: /[A-Za-z]:\\Users\\[^\\/\s]+/gi, replace: (m) => m.replace(/Users\\[^\\/\s]+/i, 'Users\\<user>') },
  // Serial device paths, which are otherwise the *whole* identifying part of the path.
  { pattern: /\/dev\/(tty|cu)[.\w-]*/gi, replace: () => '<serial-port>' },
  { pattern: /\bCOM\d+\b/g, replace: () => '<serial-port>' },
  // Bluetooth / MAC-style addresses: six colon- or hyphen-separated hex pairs.
  { pattern: /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, replace: () => '<device-address>' },
  // UUIDs (used as Bluetooth service class ids, among other things).
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: () => '<uuid>' },
  // Long hex or high-entropy alphanumeric runs - hashes, serial numbers, tokens.
  { pattern: /\b[0-9a-f]{16,}\b/gi, replace: () => '<redacted>' },
  {
    pattern: /\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
    replace: () => '<redacted>',
  },
  // Any remaining absolute filesystem path is reduced to just its basename. Skips
  // anything an earlier rule already redacted (recognisable by a "<...>" placeholder
  // it left behind) so "/Users/<user>/Documents/x.json" is not chewed down further to
  // just "x.json" - the home-directory rules above already made that segment safe, and
  // the rest of the path is worth keeping for a teacher to read.
  {
    pattern: /(?:[A-Za-z]:\\|\/)[^\s"']*[/\\][^\s"'/\\]+/g,
    replace: (m) => {
      if (/<[a-z-]+>/.test(m)) return m;
      const parts = m.split(/[/\\]/).filter(Boolean);
      return parts.length ? `<path>/${parts[parts.length - 1]}` : m;
    },
  },
];

/** Applies every redaction rule once, in order. Idempotent on already-redacted text. */
export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}
