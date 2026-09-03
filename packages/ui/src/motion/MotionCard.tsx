import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './MotionCard.module.css';
export interface MotionCardProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; interactive?: boolean; delay?: number; }
export function MotionCard({ children, interactive = false, delay = 0, style, className, ...props }: MotionCardProps) {
  const safeDelay = Number.isFinite(delay) ? Math.min(1000, Math.max(0, delay)) : 0;
  return <div {...props} className={[styles.card, interactive ? styles.interactive : '', className ?? ''].filter(Boolean).join(' ')} style={{ ...style, '--motion-delay': `${safeDelay}ms` } as CSSProperties}>{children}</div>;
}
