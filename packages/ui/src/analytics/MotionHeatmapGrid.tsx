'use client';

import React, { useState } from 'react';
import styles from './MotionHeatmapGrid.module.css';

export interface HeatmapCell {
  readonly hour: number;
  readonly value: number;
  readonly label?: string;
}

export interface MotionHeatmapGridProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly cells: readonly HeatmapCell[];
  readonly color?: string;
  readonly className?: string;
}

export function MotionHeatmapGrid({
  title,
  subtitle,
  cells,
  color = '#22c55e',
  className,
}: MotionHeatmapGridProps) {
  const [hoverCell, setHoverCell] = useState<HeatmapCell | null>(null);

  const maxVal = Math.max(...cells.map((c) => c.value), 1);

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle ? (
          <span className={styles.subtitle}>{subtitle}</span>
        ) : hoverCell ? (
          <span className={styles.subtitle} style={{ color: 'var(--theme-text-primary)' }}>
            Hour {hoverCell.hour}:00 — {hoverCell.value} events {hoverCell.label ? `(${hoverCell.label})` : ''}
          </span>
        ) : null}
      </div>

      <div className={styles.grid}>
        {Array.from({ length: 24 }).map((_, hour) => {
          const cell = cells.find((c) => c.hour === hour) ?? { hour, value: 0 };
          const intensity = cell.value > 0 ? Math.max(0.15, cell.value / maxVal) : 0;

          return (
            <div
              key={hour}
              className={styles.cell}
              style={
                intensity > 0
                  ? {
                      background: `color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, var(--theme-surface-raised, #121514))`,
                      borderColor: `color-mix(in srgb, ${color} 40%, var(--theme-border, #1e2220))`,
                    }
                  : undefined
              }
              onMouseEnter={() => setHoverCell(cell)}
              onMouseLeave={() => setHoverCell(null)}
            />
          );
        })}
      </div>

      <div className={styles.axisLabels}>
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>
  );
}
