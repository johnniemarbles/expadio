import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionTabs.module.css';

export interface MotionTabsProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; }
export function MotionTabs({ children, className, ...props }: MotionTabsProps) {
  return <div {...props} role="tablist" className={[styles.tabs, className ?? ''].filter(Boolean).join(' ')}>{children}</div>;
}
