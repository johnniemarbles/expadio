'use client';

import React, { useLayoutEffect, useRef, type CSSProperties } from 'react';
import styles from './MotionList.module.css';

export interface MotionListProps extends React.HTMLAttributes<HTMLDivElement> { stagger?: number; }
export function MotionList({ children, className = '', stagger = 40, style, ...props }: MotionListProps) {
  const safeStagger = Math.min(200, Math.max(0, stagger));
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    [...(container.current?.children ?? [])].forEach((child, index) => {
      (child as HTMLElement).style.setProperty('--motion-index', String(index));
    });
  }, [children]);
  return <div {...props} ref={container} className={[styles.list, className].filter(Boolean).join(' ')} style={{ ...style, '--motion-stagger': `${safeStagger}ms` } as CSSProperties}>{children}</div>;
}
