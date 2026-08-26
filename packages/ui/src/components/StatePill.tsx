import React from 'react';
import styles from './StatePill.module.css';

export interface StatePillProps {
  state: 'Published' | 'Review' | 'Draft';
  className?: string;
}

export function StatePill({ state, className = '' }: StatePillProps) {
  return (
    <span className={`${styles.pill} ${styles[state.toLowerCase()]} ${className}`}>
      {state}
    </span>
  );
}
