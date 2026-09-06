'use client';

import React, { useState, useId } from 'react';
import styles from './MotionSparkline.module.css';

export interface MotionSparklinePoint {
  readonly value: number;
  readonly label?: string;
}

export interface MotionSparklineProps {
  readonly data: readonly (number | MotionSparklinePoint)[];
  readonly width?: number;
  readonly height?: number;
  readonly color?: string;
  readonly showArea?: boolean;
  readonly className?: string;
}

export function MotionSparkline({
  data,
  width = 120,
  height = 36,
  color = 'var(--theme-primary, #facc15)',
  showArea = true,
  className,
}: MotionSparklineProps) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const points: MotionSparklinePoint[] = data.map((d) =>
    typeof d === 'number' ? { value: d } : d,
  );

  if (points.length < 2) {
    return <div className={[styles.sparkline, className].filter(Boolean).join(' ')} style={{ width, height }} />;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min === 0 ? 1 : max - min;
  const padding = 4;
  const chartHeight = height - padding * 2;
  const chartWidth = width - padding * 2;

  const getX = (i: number) => padding + (i / (points.length - 1)) * chartWidth;
  const getY = (v: number) => padding + chartHeight - ((v - min) / range) * chartHeight;

  const pathPoints = points.map((p, i) => `${getX(i)},${getY(p.value)}`).join(' L ');
  const pathD = `M ${pathPoints}`;

  const areaD = `${pathD} L ${getX(points.length - 1)},${height - padding} L ${padding},${height - padding} Z`;

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;
  const activeX = hoverIndex !== null ? getX(hoverIndex) : 0;
  const activeY = hoverIndex !== null ? getY(activePoint?.value ?? 0) : 0;

  return (
    <div
      className={[styles.sparkline, className].filter(Boolean).join(' ')}
      style={{ width, height, '--spark-color': color } as React.CSSProperties}
      onMouseLeave={() => setHoverIndex(null)}
    >
      {activePoint && (
        <div className={styles.tooltip} style={{ left: activeX }}>
          {activePoint.label ? `${activePoint.label}: ` : ''}
          {activePoint.value.toLocaleString()}
        </div>
      )}
      <svg
        className={styles.svg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - padding;
          const idx = Math.max(
            0,
            Math.min(
              points.length - 1,
              Math.round((mouseX / chartWidth) * (points.length - 1)),
            ),
          );
          setHoverIndex(idx);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {showArea && <path className={styles.fill} d={areaD} fill={`url(#${gradientId})`} />}
        <path className={styles.path} d={pathD} />
        {hoverIndex !== null && (
          <circle
            className={styles.cursorDot}
            cx={activeX}
            cy={activeY}
            r={4}
          />
        )}
      </svg>
    </div>
  );
}
