'use client';

import React from 'react';
import styles from './MotionRadialGauge.module.css';

export interface MotionRadialGaugeProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly value: number;
  readonly max?: number;
  readonly unit?: string;
  readonly color?: string;
  readonly className?: string;
}

export function MotionRadialGauge({
  title,
  subtitle,
  value,
  max = 100,
  unit = '%',
  color = 'var(--theme-primary, #facc15)',
  className,
}: MotionRadialGaugeProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const size = 140;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;

  // Semi-circle arc: length is PI * radius
  const arcLength = Math.PI * radius;
  const strokeDashoffset = arcLength - (pct / 100) * arcLength;

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.gaugeWrap}>
        <svg className={styles.svg} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
          <path
            className={styles.track}
            d={`M ${strokeWidth / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeWidth / 2},${size / 2}`}
          />
          <path
            className={styles.fill}
            d={`M ${strokeWidth / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeWidth / 2},${size / 2}`}
            stroke={color}
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className={styles.centerValue}>
          <span className={styles.val}>{Math.round(pct)}</span>
          <span className={styles.unit}>{unit}</span>
        </div>
      </div>
    </div>
  );
}
