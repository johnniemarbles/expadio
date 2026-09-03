'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionDrawer.module.css';
export interface MotionDrawerProps extends HTMLAttributes<HTMLElement> { open: boolean; children: ReactNode; side?: 'left' | 'right'; }
export function MotionDrawer({ open, children, side = 'right', className, ...props }: MotionDrawerProps) {
  return <aside {...props} aria-hidden={!open} inert={!open ? true : undefined} data-state={open ? 'open' : 'closed'} data-side={side} className={[styles.drawer, className ?? ''].filter(Boolean).join(' ')}>{children}</aside>;
}
