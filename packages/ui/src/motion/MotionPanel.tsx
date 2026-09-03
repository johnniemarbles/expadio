'use client';

import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import styles from './MotionPanel.module.css';

export interface MotionPanelProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; open?: boolean; exitDuration?: number; }
export function MotionPanel({ children, open = true, exitDuration = 360, className, ...props }: MotionPanelProps) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const timer = window.setTimeout(() => setMounted(false), Math.max(0, exitDuration));
    return () => window.clearTimeout(timer);
  }, [exitDuration, open]);
  if (!mounted) return null;
  return <div {...props} className={[styles.panel, open ? styles.open : '', className ?? ''].filter(Boolean).join(' ')} aria-hidden={!open} inert={!open ? true : undefined} data-state={open ? 'open' : 'closing'}>{children}</div>;
}
