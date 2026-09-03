'use client';

import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './MotionModal.module.css';

export interface MotionModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}

export function MotionModal({ open, title, children, onClose, className, ...props }: MotionModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current?.(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) { event.preventDefault(); dialog.current.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div {...props} ref={dialog} role="dialog" aria-modal="true" aria-labelledby={props['aria-label'] ? undefined : props['aria-labelledby'] ?? titleId} tabIndex={-1} className={[styles.dialog, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.title} id={titleId}>{title}</div>{children}
    </div>
  </div>;
}
