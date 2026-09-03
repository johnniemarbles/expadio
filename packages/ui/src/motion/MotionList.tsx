import React, { isValidElement, type CSSProperties } from 'react';
import styles from './MotionList.module.css';

export interface MotionListProps extends React.HTMLAttributes<HTMLDivElement> { stagger?: number; }
export function MotionList({ children, className = '', stagger = 40, style, ...props }: MotionListProps) {
  const safeStagger = Math.min(200, Math.max(0, stagger));
  return <div {...props} className={[styles.list, className].filter(Boolean).join(' ')} style={{ ...style, '--motion-stagger': `${safeStagger}ms` } as CSSProperties}>
    {React.Children.toArray(children).map((child, index) => isValidElement(child)
      ? React.cloneElement(child as React.ReactElement<{ style?: CSSProperties }>, { style: { ...(child.props as { style?: CSSProperties }).style, '--motion-index': index } as CSSProperties })
      : child)}
  </div>;
}
