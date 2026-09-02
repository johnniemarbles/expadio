import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionPanel.module.css';

export interface MotionPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  open?: boolean;
}

export function MotionPanel({ children, open = true, className, ...props }: MotionPanelProps) {
  return (
    <div
      {...props}
      className={[styles.panel, open ? styles.open : '', className ?? ''].filter(Boolean).join(' ')}
      aria-hidden={!open}
      data-state={open ? 'open' : 'closed'}
      hidden={!open}
    >
      {children}
    </div>
  );
}
