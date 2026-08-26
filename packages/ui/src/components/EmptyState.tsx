import React from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ title, description, className = '' }: EmptyStateProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
