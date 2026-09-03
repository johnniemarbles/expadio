import React from 'react';
import styles from './MotionStatus.module.css';

export interface MotionStatusProps {
  readonly status: string | null;
}

export function MotionStatus({ status }: MotionStatusProps) {
  if (!status) return null;

  return (
    <div className={styles.statusContainer} role="status">
      <div className={styles.statusIcon}>
        <div className={styles.spinner} />
      </div>
      <div className={styles.statusTextWrapper}>
        <p className={styles.statusText} key={status}>
          {status}
        </p>
      </div>
    </div>
  );
}
