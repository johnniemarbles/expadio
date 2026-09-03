import type { ButtonHTMLAttributes } from 'react';
import styles from './MotionButton.module.css';

export interface MotionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'secondary' | 'danger';
}

export function MotionButton({ tone = 'secondary', className, type = 'button', ...props }: MotionButtonProps) {
  return <button {...props} type={type} className={[styles.button, styles[tone], className ?? ''].filter(Boolean).join(' ')} />;
}
