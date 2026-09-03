'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './MotionModal.module.css';

export interface MotionModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}

export function MotionModal({ open, title, children, onClose, className, ...props }: MotionModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('keydown', close); previous?.focus(); };
  }, [onClose, open]);
  if (!open) return null;
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div {...props} ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} className={[styles.dialog, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.title}>{title}</div>{children}
    </div>
  </div>;
}
