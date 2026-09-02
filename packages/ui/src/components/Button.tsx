import React from 'react';
import styles from './Button.module.css';

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function Button({ tone='primary', size='md', className='', ...props }: ButtonProps) {
  return <button {...props} className={[styles.button,styles[tone],styles[size],className].filter(Boolean).join(' ')} />;
}
