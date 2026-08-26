import React from 'react';
import styles from './RiskBadge.module.css';

export interface RiskBadgeProps {
  risk: 'Low' | 'Medium' | 'High';
  className?: string;
}

export function RiskBadge({ risk, className = '' }: RiskBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[risk.toLowerCase()]} ${className}`}>
      {risk} Risk
    </span>
  );
}
