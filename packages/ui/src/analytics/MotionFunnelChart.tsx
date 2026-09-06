'use client';

import React from 'react';
import styles from './MotionFunnelChart.module.css';

export interface FunnelStep {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

export interface MotionFunnelChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly steps: readonly FunnelStep[];
  readonly className?: string;
}

export function MotionFunnelChart({
  title,
  subtitle,
  steps,
  className,
}: MotionFunnelChartProps) {
  const firstStep = steps[0];
  const firstValue = firstStep ? Math.max(firstStep.value, 1) : 1;

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.funnelList}>
        {steps.map((step, idx) => {
          const pctOfFirst = Math.min(100, Math.round((step.value / firstValue) * 100));
          const prevStep = idx > 0 ? steps[idx - 1] : undefined;
          const prevValue = prevStep ? prevStep.value : null;
          const dropPct = prevValue && prevValue > 0 ? Math.round(((prevValue - step.value) / prevValue) * 100) : null;
          const color = step.color ?? 'var(--theme-primary, #facc15)';

          return (
            <div key={step.id} className={styles.funnelStep}>
              {dropPct !== null && dropPct > 0 && (
                <div className={styles.dropoff}>
                  <span className={styles.dropoffDot} />
                  <span>{dropPct}% conversion drop ({prevValue! - step.value} lost)</span>
                </div>
              )}
              <div
                className={styles.stepBar}
                style={{ '--step-color': color } as React.CSSProperties}
              >
                <div className={styles.fill} style={{ width: `${pctOfFirst}%` }} />
                <span className={styles.stepLabel}>{step.label}</span>
                <div className={styles.stepMetrics}>
                  <span className={styles.stepValue}>{step.value.toLocaleString()}</span>
                  <span className={styles.stepPct}>({pctOfFirst}%)</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
