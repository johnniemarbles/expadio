'use client';

import React, { useState } from 'react';
import styles from './MotionDonutChart.module.css';

export interface DonutSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface MotionDonutChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly segments: readonly DonutSegment[];
  readonly centerLabel?: string;
  readonly className?: string;
}

export function MotionDonutChart({
  title,
  subtitle,
  segments,
  centerLabel = 'Total',
  className,
}: MotionDonutChartProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const size = 160;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;

  const segmentArcs = segments.map((s) => {
    const percent = total > 0 ? s.value / total : 0;
    const strokeDasharray = `${percent * circumference} ${circumference}`;
    const strokeDashoffset = -accumulatedPercent * circumference;
    accumulatedPercent += percent;

    return {
      ...s,
      percent,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeSegment = hoverId ? segments.find((s) => s.id === hoverId) : null;

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.body}>
        <div className={styles.chartWrap}>
          <svg className={styles.svg} viewBox={`0 0 ${size} ${size}`}>
            {segmentArcs.map((arc) => (
              <circle
                key={arc.id}
                className={styles.segment}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={hoverId === arc.id ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={arc.strokeDasharray}
                strokeDashoffset={arc.strokeDashoffset}
                onMouseEnter={() => setHoverId(arc.id)}
                onMouseLeave={() => setHoverId(null)}
              />
            ))}
          </svg>
          <div className={styles.centerText}>
            <span className={styles.centerValue}>
              {activeSegment ? activeSegment.value.toLocaleString() : total.toLocaleString()}
            </span>
            <span className={styles.centerLabel}>
              {activeSegment ? activeSegment.label : centerLabel}
            </span>
          </div>
        </div>

        <div className={styles.legendList}>
          {segments.map((s) => {
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <div
                key={s.id}
                className={styles.legendRow}
                data-hover={hoverId === s.id}
                onMouseEnter={() => setHoverId(s.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <div className={styles.legendLeft}>
                  <span className={styles.dot} style={{ background: s.color }} />
                  <span className={styles.legendLabel}>{s.label}</span>
                </div>
                <div className={styles.legendRight}>
                  <span className={styles.legendValue}>{s.value.toLocaleString()}</span>
                  <span className={styles.legendPct}>({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
