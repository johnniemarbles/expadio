import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './MotionCard.module.css';

export interface MotionCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  delay?: number;
}

export function MotionCard({ children, interactive = false, delay = 0, style, className, ...props }: MotionCardProps) {
  const classes = [styles.card, interactive ? styles.interactive : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div
      {...props}
      className={classes}
      style={{ ...style, '--motion-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
