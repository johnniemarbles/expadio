import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionActivity.module.css';

export type MotionActivityState = 'idle' | 'pending' | 'processing' | 'success' | 'warning' | 'failure';

export interface MotionActivityProps extends HTMLAttributes<HTMLDivElement> {
  state: MotionActivityState;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
}

export function MotionActivity({ state, title, detail, meta, className, ...props }: MotionActivityProps) {
  const live = state === 'pending' || state === 'processing';

  return (
    <div
      {...props}
      className={[styles.activity, styles[state], className ?? ''].filter(Boolean).join(' ')}
      data-state={state}
      aria-busy={live || undefined}
    >
      <span className={styles.marker} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {detail ? <div className={styles.detail}>{detail}</div> : null}
      </div>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
    </div>
  );
}
