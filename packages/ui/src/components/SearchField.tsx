import React from 'react';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}

export function SearchField({ value, onChange, placeholder = 'Search...', label }: SearchFieldProps) {
  return (
    <div className={styles.container}>
      <label htmlFor="search-input" className="sr-only">
        {label}
      </label>
      <div className={styles.inputWrapper}>
        <span className={styles.icon} aria-hidden="true">🔍</span>
        <input
          id="search-input"
          type="search"
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
    </div>
  );
}
