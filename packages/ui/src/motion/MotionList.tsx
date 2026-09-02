import React from 'react';
import styles from './MotionList.module.css';

export interface MotionListProps extends React.HTMLAttributes<HTMLDivElement> {
  stagger?: number;
}

export function MotionList({ children, className = '', stagger = 40, style, ...props }: MotionListProps) {
  const items = React.Children.toArray(children);
  return (
    <div
      {...props}
      className={[styles.list, className].filter(Boolean).join(' ')}
      style={{ ...style, ['--motion-stagger' as string]: `${Math.max(0, stagger)}ms` }}
    >
      {items.map((child, index) => (
        <React.Fragment key={index}>{child}</React.Fragment>
      ))}
    </div>
  );
}
