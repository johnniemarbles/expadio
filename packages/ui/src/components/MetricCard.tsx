import React from 'react';
import styles from './MetricCard.module.css';
import { HealthTone } from '../contracts.js';

export interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  tone: HealthTone;
}

export function MetricCard({ label, value, detail, tone }: MetricCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={`${styles.dot} ${styles[tone]}`} aria-label={`Health tone: ${tone}`} />
      </div>
      <div className={styles.value}>{value}</div>
      <div className={styles.detail}>{detail}</div>
    </div>
  );
}
