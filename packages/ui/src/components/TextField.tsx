import React from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, className='', ...props }: TextFieldProps) {
  const inputId=id ?? props.name;
  return <label className={styles.field} htmlFor={inputId}>
    {label ? <span className={styles.label}>{label}</span> : null}
    <input {...props} id={inputId} className={[styles.input,error?styles.invalid:'',className].filter(Boolean).join(' ')} />
    {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
  </label>;
}
