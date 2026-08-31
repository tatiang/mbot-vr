/**
 * Inline SVG icons. Bundled rather than loaded from a font or sprite sheet so
 * the app works with no network at all - a real constraint on school wifi.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </Icon>
);

export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const ResetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 4 3 9 8 9" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h4" />
  </Icon>
);

export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.2a3 3 0 0 1 5.6 1.3c0 2-2.8 2.5-2.8 4" />
    <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </Icon>
);

/** Two sensor eyes over a line - the line-follower overlay toggle. */
export const LineSensorIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 17h18" />
    <circle cx="9" cy="9" r="2" />
    <circle cx="15" cy="9" r="2" />
    <path d="M9 11v3M15 11v3" />
  </Icon>
);

export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Icon>
);

export const GamepadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 12h4M9 10v4" />
    <circle cx="16" cy="11" r="0.8" fill="currentColor" />
    <circle cx="18" cy="13.5" r="0.8" fill="currentColor" />
    <path d="M5.5 7h13a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1.6a2 2 0 0 1-1.7-1l-.5-.8a2 2 0 0 0-1.7-1h-2a2 2 0 0 0-1.7 1l-.5.8a2 2 0 0 1-1.7 1H5.5a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p} size={p.size ?? 14}>
    <polyline points="9 6 15 12 9 18" />
  </Icon>
);

export const RobotIcon = (p: IconProps) => (
  <Icon {...p} stroke="#fff">
    <rect x="4.5" y="8" width="15" height="10" rx="2.5" />
    <circle cx="9.2" cy="13" r="1.3" fill="#fff" stroke="none" />
    <circle cx="14.8" cy="13" r="1.3" fill="#fff" stroke="none" />
    <path d="M12 8V5" />
    <circle cx="12" cy="4" r="1.2" fill="#fff" stroke="none" />
  </Icon>
);

/** Same robot glyph as {@link RobotIcon}, but in `currentColor` for use on a
 * plain button rather than the brand mark's solid background. */
export const OpponentRobotIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="8" width="15" height="10" rx="2.5" />
    <circle cx="9.2" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <path d="M12 8V5" />
    <circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <polyline points="7 11 12 16 17 11" />
    <path d="M4 19h16" />
  </Icon>
);

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20V8" />
    <polyline points="7 12 12 7 17 12" />
    <path d="M4 4h16" />
  </Icon>
);

export const SaveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M8 4v5h7V4M8 20v-5h8v5" />
  </Icon>
);
