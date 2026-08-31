import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  left: ReactNode;
  right: ReactNode;
  /** Starting width of the left pane as a fraction of the container. */
  initialRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  onResize?: () => void;
  /** On narrow screens the panes stack and this picks which one is shown. */
  stackedVisible?: 'left' | 'right' | 'both';
}

/**
 * Resizable two-pane split.
 *
 * The divider is a real button so it can be moved with the arrow keys - dragging
 * a 12 px target is not something every student can do reliably.
 */
export function SplitPane({
  left,
  right,
  initialRatio = 0.46,
  minRatio = 0.25,
  maxRatio = 0.75,
  onResize,
  stackedVisible = 'both',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const draggingRef = useRef(false);

  const clampRatio = useCallback(
    (value: number) => Math.max(minRatio, Math.min(maxRatio, value)),
    [minRatio, maxRatio],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      setRatio(clampRatio((event.clientX - rect.left) / rect.width));
    };
    const onPointerUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [clampRatio]);

  // Blockly and the canvas both need to re-measure after the split moves.
  useEffect(() => {
    onResize?.();
  }, [ratio, onResize]);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const nudge = (delta: number) => setRatio((r) => clampRatio(r + delta));

  const leftHidden = stackedVisible === 'right';
  const rightHidden = stackedVisible === 'left';

  return (
    <div className="split" ref={containerRef}>
      <div
        className={`split__pane${leftHidden ? ' split__pane--hidden' : ''}`}
        style={{ flex: `0 0 ${ratio * 100}%` }}
      >
        {left}
      </div>
      <button
        type="button"
        className="split__divider"
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(-0.02);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(0.02);
          }
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the programming and playground panels"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
      />
      <div className={`split__pane${rightHidden ? ' split__pane--hidden' : ''}`} style={{ flex: '1 1 0' }}>
        {right}
      </div>
    </div>
  );
}
