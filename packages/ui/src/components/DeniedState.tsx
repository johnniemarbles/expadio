import React from 'react';
import styles from './DeniedState.module.css';
import { DeniedResult } from '../contracts.js';

export interface DeniedStateProps {
  result: DeniedResult;
}

export function DeniedState({ result }: DeniedStateProps) {
  return (
    <div className={styles.container} role="alert">
      <div className={styles.icon} aria-hidden="true">🔒</div>
      <h3 className={styles.title}>Access Denied</h3>
      <p className={styles.message}>{result.message}</p>
      {result.correlationId && (
        <div className={styles.meta}>
          Correlation ID: {result.correlationId}
        </div>
      )}
    </div>
  );
}
