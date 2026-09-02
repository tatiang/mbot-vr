import type { HardwareIssue } from '../device/types';

interface Props {
  issues: readonly HardwareIssue[];
  onFocusBlock?: (blockId: string) => void;
}

const SEVERITY_LABEL: Record<HardwareIssue['severity'], string> = {
  blocking: 'Blocked',
  warning: 'Warning',
  note: 'Note',
};

/**
 * Shows what `assessHardwareCompatibility` found, before a student ever presses
 * "Run on robot". See `docs/hardware-bridge-plan.md` §10 - this is meant to be visible
 * while building, not just sprung on a student at send time.
 */
export function PreflightList({ issues, onFocusBlock }: Props) {
  if (issues.length === 0) {
    return <p className="hint-text" style={{ padding: '10px 12px' }}>These blocks are all fine on a real robot.</p>;
  }

  return (
    <ul className="preflight-list">
      {issues.map((issue, index) => (
        <li key={`${issue.blockId ?? 'program'}-${index}`} className={`preflight-item preflight-item--${issue.severity}`}>
          <span className="preflight-item__badge">{SEVERITY_LABEL[issue.severity]}</span>
          <span className="preflight-item__text">{issue.message}</span>
          {issue.blockId && onFocusBlock && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => onFocusBlock(issue.blockId!)}
            >
              Show block
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
