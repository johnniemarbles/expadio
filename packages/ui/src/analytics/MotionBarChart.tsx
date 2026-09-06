'use client';

import React from 'react';
import styles from './MotionBarChart.module.css';

export interface BarChartItem {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly maxValue?: number;
  readonly color?: string;
  readonly formattedValue?: string;
}

export interface MotionBarChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly BarChartItem[];
  readonly className?: string;
}

export function MotionBarChart({
  title,
  subtitle,
  items,
  className,
}: MotionBarChartProps) {
  const maxVal = Math.max(...items.map((i) => i.maxValue ?? i.value), 1);

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.chart}>
        {items.map((item) => {
          const pct = Math.min(100, Math.max(0, (item.value / maxVal) * 100));
          const color = item.color ?? 'var(--theme-primary, #facc15)';

          return (
            <div key={item.id} className={styles.barRow}>
              <div className={styles.labelRow}>
                <span className={styles.barLabel}>{item.label}</span>
                <span className={styles.barVal}>
                  {item.formattedValue ?? item.value.toLocaleString()}
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
