'use client';

import React, { useState, useId } from 'react';
import styles from './MotionAreaChart.module.css';

export interface AreaChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly data: readonly number[];
}

export interface MotionAreaChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly categories: readonly string[];
  readonly series: readonly AreaChartSeries[];
  readonly height?: number;
  readonly className?: string;
}

export function MotionAreaChart({
  title,
  subtitle,
  categories,
  series,
  height = 200,
  className,
}: MotionAreaChartProps) {
  const chartId = useId();
  const [activeSeries, setActiveSeries] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(series.map((s) => [s.id, true])),
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const visibleSeries = series.filter((s) => activeSeries[s.id] ?? true);

  const allValues = visibleSeries.flatMap((s) => s.data);
  const maxVal = allValues.length > 0 ? Math.max(...allValues, 10) : 100;
  const minVal = 0;

  const paddingLeft = 36;
  const paddingBottom = 24;
  const paddingTop = 12;
  const paddingRight = 12;

  const svgWidth = 600;
  const svgHeight = height;

  const chartW = svgWidth - paddingLeft - paddingRight;
  const chartH = svgHeight - paddingTop - paddingBottom;

  const getX = (index: number) => {
    if (categories.length <= 1) return paddingLeft + chartW / 2;
    return paddingLeft + (index / (categories.length - 1)) * chartW;
  };

  const getY = (val: number) => {
    return paddingTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
  };

  const toggleSeries = (id: string) => {
    setActiveSeries((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Y-axis grid ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    val: Math.round(maxVal * pct),
    y: getY(maxVal * pct),
  }));

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
        <div className={styles.legend}>
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.legendItem}
              data-active={activeSeries[s.id] ?? true}
              onClick={() => toggleSeries(s.id)}
            >
              <span className={styles.legendDot} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartWrapper} style={{ height }}>
        {hoverIndex !== null && hoverIndex < categories.length && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(getX(hoverIndex) / svgWidth) * 100}%`,
            }}
          >
            <div className={styles.tooltipTime}>{categories[hoverIndex]}</div>
            {visibleSeries.map((s) => (
              <div key={s.id} className={styles.tooltipRow}>
                <span style={{ color: s.color }}>{s.label}:</span>
                <span className={styles.tooltipVal}>
                  {(s.data[hoverIndex] ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <svg
          className={styles.svg}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, (mouseX - (paddingLeft / svgWidth) * rect.width) / ((chartW / svgWidth) * rect.width)));
            const idx = Math.round(pct * (categories.length - 1));
            setHoverIndex(idx);
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient
                key={s.id}
                id={`${chartId}-${s.id}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines & Y labels */}
          {yTicks.map((t, idx) => (
            <g key={idx}>
              <line
                className={styles.gridLine}
                x1={paddingLeft}
                y1={t.y}
                x2={svgWidth - paddingRight}
                y2={t.y}
              />
              <text
                className={styles.axisText}
                x={paddingLeft - 6}
                y={t.y + 3}
                textAnchor="end"
              >
                {t.val >= 1000 ? `${(t.val / 1000).toFixed(1)}k` : t.val}
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {categories.map((cat, i) => {
            const step = Math.max(1, Math.floor(categories.length / 6));
            if (i % step !== 0 && i !== categories.length - 1) return null;
            return (
              <text
                key={i}
                className={styles.axisText}
                x={getX(i)}
                y={svgHeight - 4}
                textAnchor="middle"
              >
                {cat}
              </text>
            );
          })}

          {/* Area & Line paths */}
          {visibleSeries.map((s) => {
            if (s.data.length < 2) return null;
            const pathPoints = s.data.map((v, i) => `${getX(i)},${getY(v)}`).join(' L ');
            const pathD = `M ${pathPoints}`;
            const areaD = `${pathD} L ${getX(s.data.length - 1)},${paddingTop + chartH} L ${getX(0)},${paddingTop + chartH} Z`;

            return (
              <g key={s.id}>
                <path
                  className={styles.area}
                  d={areaD}
                  fill={`url(#${chartId}-${s.id})`}
                />
                <path
                  className={styles.line}
                  d={pathD}
                  stroke={s.color}
                />
              </g>
            );
          })}

          {/* Hover Crosshair */}
          {hoverIndex !== null && hoverIndex < categories.length && (
            <line
              className={styles.crosshair}
              x1={getX(hoverIndex)}
              y1={paddingTop}
              x2={getX(hoverIndex)}
              y2={paddingTop + chartH}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
