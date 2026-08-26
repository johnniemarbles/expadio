import React from 'react';
import styles from './SourceBadge.module.css';
import { DataSource } from '../contracts.js';

export interface SourceBadgeProps {
  source: DataSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  return (
    <div className={`${styles.badge} ${styles[source.kind]}`} title={`Captured at: ${source.capturedAt}`}>
      <span className={styles.dot} aria-hidden="true" />
      <span>{source.label} ({source.kind})</span>
    </div>
  );
}
