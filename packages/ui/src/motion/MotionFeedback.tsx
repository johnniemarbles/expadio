import type { HTMLAttributes, ReactNode } from 'react';
import styles from './MotionFeedback.module.css';

export type MotionFeedbackTone = 'info' | 'success' | 'warning' | 'danger';

export interface MotionFeedbackProps extends HTMLAttributes<HTMLDivElement> {
  tone?: MotionFeedbackTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

export function MotionFeedback({ tone = 'info', title, children, action, className, ...props }: MotionFeedbackProps) {
  return (
    <div {...props} className={[styles.feedback, styles[tone], className ?? ''].filter(Boolean).join(' ')} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {children ? <div className={styles.content}>{children}</div> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
