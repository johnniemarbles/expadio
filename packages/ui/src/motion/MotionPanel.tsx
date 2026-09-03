'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useMotionPreferences } from './MotionProvider';
import styles from './MotionPanel.module.css';

export interface MotionPanelProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; open?: boolean; }
export function MotionPanel({ children, open = true, className, ...props }: MotionPanelProps) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPreferences();
  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (reduced) { setMounted(false); return; }
    const durations = panel.current ? getComputedStyle(panel.current).transitionDuration.split(',').map((value) => value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000) : [0];
    const timer = window.setTimeout(() => setMounted(false), Math.max(0, ...durations) + 50);
    return () => window.clearTimeout(timer);
  }, [open, reduced]);
  if (!mounted) return null;
  return <div {...props} ref={panel} className={[styles.panel, open ? styles.open : '', className ?? ''].filter(Boolean).join(' ')} aria-hidden={!open} inert={!open ? true : undefined} data-state={open ? 'open' : 'closing'}>{children}</div>;
}
