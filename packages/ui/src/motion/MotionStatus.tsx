import type { ReactNode } from 'react';
import styles from './MotionStatus.module.css';

export type MotionStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface MotionStatusProps {
  children: ReactNode;
  tone?: MotionStatusTone;
  live?: boolean;
}

export function MotionStatus({ children, tone = 'neutral', live = false }: MotionStatusProps) {
  return (
    <span className={`${styles.status} ${styles[tone]}`} data-live={live || undefined}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
