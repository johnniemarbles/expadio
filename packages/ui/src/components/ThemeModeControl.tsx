'use client';

import { useEffect, useState } from 'react';
import type { ThemeMode } from '../theme';
import styles from './ThemeModeControl.module.css';

const COOKIE = 'expadio-theme-mode';
const MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

function validMode(value: string | undefined): ThemeMode {
  return value === 'light' || value === 'system' ? value : 'dark';
}

export function ThemeModeControl() {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    setMode(validMode(document.documentElement.dataset.theme));
  }, []);

  function choose(next: ThemeMode) {
    document.documentElement.dataset.theme = next;
    document.cookie = `${COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setMode(next);
  }

  return (
    <div className={styles.control} aria-label="Appearance mode">
      {MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          className={[styles.button, mode === item.value ? styles.active : ''].join(' ')}
          aria-pressed={mode === item.value}
          onClick={() => choose(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
