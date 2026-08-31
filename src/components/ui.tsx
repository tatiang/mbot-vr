import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronIcon, CloseIcon } from './icons';

/* ==========================================================================
   Toasts
   Non-blocking status messages. Modal dialogs interrupt a class mid-thought,
   so every message the app produces surfaces here instead.
   ========================================================================== */

export type ToastKind = 'info' | 'error' | 'success';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__text">{toast.text}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss message"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   Drawer - side sheet for help, projects and examples
   ========================================================================== */

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes, and focus moves into the drawer so keyboard users are not
  // stranded behind it.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="drawer__header">
          <h2 className="drawer__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </>
  );
}

/* ==========================================================================
   Collapsible section
   ========================================================================== */

export function Collapsible({
  title,
  defaultOpen = false,
  right,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="panel">
      <div className="panel__header">
        <button
          type="button"
          className="collapse__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <ChevronIcon className={`collapse__chevron${open ? ' collapse__chevron--open' : ''}`} />
          <h2 className="panel__title">{title}</h2>
        </button>
        {right}
      </div>
      {open && (
        <div className="panel__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   Toggle button
   ========================================================================== */

export function ToggleButton({
  pressed,
  onToggle,
  children,
  title,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`btn btn--sm${pressed ? ' btn--toggled' : ''}`}
      aria-pressed={pressed}
      onClick={onToggle}
      title={title}
    >
      {children}
    </button>
  );
}
