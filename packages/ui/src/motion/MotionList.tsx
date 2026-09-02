import React from 'react';
import styles from './MotionList.module.css';

export interface MotionListProps extends React.HTMLAttributes<HTMLDivElement> {
  stagger?: number;
}

export function MotionList({ children, className = '', stagger = 40, style, ...props }: MotionListProps) {
  return (
    <div
      {...props}
      className={[styles.list, className].filter(Boolean).join(' ')}
      style={{ ...style, ['--motion-stagger' as string]: `${Math.max(0, stagger)}ms` }}
    >
      {children}
    </div>
  );
}
