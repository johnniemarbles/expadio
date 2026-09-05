'use client';

import { useEffect, useState } from 'react';
import { EXPADIO_COMMAND_OBSIDIAN, themeVariableMap, type ThemeMode } from '../theme';
import styles from './ThemeModeControl.module.css';

const COOKIE = 'expadio-theme-mode';
const MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

function validMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function apply(next: ThemeMode) {
  document.documentElement.dataset.theme = next;
  document.cookie = `${COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;

  const effectiveMode = next === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : next;

  const vars = themeVariableMap(EXPADIO_COMMAND_OBSIDIAN, effectiveMode);
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}

export function ThemeModeControl({ persistenceUrl='/api/appearance/mode' }:{ persistenceUrl?:string }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    const local=document.documentElement.dataset.theme;
    if(validMode(local))setMode(local);
    const controller=new AbortController();
    void fetch(persistenceUrl,{method:'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal})
      .then(async(response)=>{
        if(!response.ok)return null;
        const payload=await response.json() as {mode?:unknown};
        return validMode(payload.mode)?payload.mode:null;
      })
      .then((persisted)=>{
        if(persisted===null)return;
        apply(persisted);
        setMode(persisted);
      })
      .catch((error)=>{
        if(!(error instanceof DOMException&&error.name==='AbortError')){
          console.error('Appearance mode sync failed',error);
        }
      });
    return ()=>controller.abort();
  }, [persistenceUrl]);

  function choose(next: ThemeMode) {
    apply(next);
    setMode(next);
    void fetch(persistenceUrl,{
      method:'POST',
      credentials:'same-origin',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({mode:next}),
    }).then((response)=>{
      if(!response.ok)throw new Error('PERSONAL_APPEARANCE_PERSIST_FAILED');
    }).catch((error)=>console.error('Appearance mode persistence failed',error));
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
