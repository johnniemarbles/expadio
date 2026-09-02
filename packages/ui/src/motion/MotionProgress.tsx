import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionProgress.module.css';

export type MotionProgressTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface MotionProgressProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  value?: number;
  max?: number;
  tone?: MotionProgressTone;
  indeterminate?: boolean;
}

function clampProgress(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function MotionProgress({
  label,
  value = 0,
  max = 100,
  tone = 'info',
  indeterminate = false,
  className,
  ...props
}: MotionProgressProps) {
  const percentage = clampProgress(value, max);
  const ariaValueProps = indeterminate
    ? {}
    : {
        'aria-valuenow': Math.round(percentage),
        'aria-valuemin': 0,
        'aria-valuemax': 100,
      };

  return (
    <div {...props} className={[styles.progress, styles[tone], className ?? ''].filter(Boolean).join(' ')}>
      {label ? <div className={styles.label}>{label}</div> : null}
      <div
        className={styles.track}
        role="progressbar"
        aria-label={typeof label === 'string' ? label : undefined}
        data-indeterminate={indeterminate || undefined}
        {...ariaValueProps}
      >
        <span className={styles.fill} style={indeterminate ? undefined : { width: `${percentage}%` }} />
      </div>
    </div>
  );
}
