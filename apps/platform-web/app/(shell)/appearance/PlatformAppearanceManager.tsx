'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  EXPADIO_THEME_PRESETS,
  type ExpadioThemeDefinition,
} from '@expadio/ui';
import styles from './appearance.module.css';
import { MotionPanel, MotionTabs, MotionFeedback } from '@expadio/ui';

type HistoryItem={recordVersion:number;authoredAt:string;reason:string;themeKey:string;themeName:string};

export function PlatformAppearanceManager({
  effectiveTheme,
  sourceLevel,
  canPublish,
  history,
}:{
  effectiveTheme:ExpadioThemeDefinition;
  sourceLevel:string;
  canPublish:boolean;
  history:readonly HistoryItem[];
}){
  const router=useRouter();
  const initial=effectiveTheme.key in EXPADIO_THEME_PRESETS?effectiveTheme.key:'expadio-command-obsidian';
  const [selected,setSelected]=useState(initial);
  const [mode,setMode]=useState<'light'|'dark'>('dark');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const theme=useMemo(
    ()=>((EXPADIO_THEME_PRESETS as Record<string,ExpadioThemeDefinition>)[selected]??effectiveTheme),
    [selected,effectiveTheme],
  );
  const palette=theme[mode];

  async function publish(body:Record<string,unknown>){
    setBusy(true);setNotice(null);
    try{
      const response=await fetch('/api/platform/appearance',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(body),
      });
      const payload=await response.json() as {denied?:boolean;message?:string;published?:{recordVersion:number}};
      if(!response.ok||payload.denied)throw new Error(payload.message??'Theme publication failed.');
      setNotice('Published immutable theme version '+payload.published?.recordVersion+'.');
      router.refresh();
    }catch(error){
      setNotice(error instanceof Error?error.message:'Theme publication failed.');
    }finally{setBusy(false)}
  }

  return <div className={styles.manager}>
    <section className={styles.toolbar}>
      <div><span>Effective source</span><strong>{sourceLevel}</strong></div>
      <div className={styles.modeSwitch}>
        <button type="button" aria-pressed={mode==='light'} onClick={()=>setMode('light')}>Light preview</button>
        <button type="button" aria-pressed={mode==='dark'} onClick={()=>setMode('dark')}>Dark preview</button>
      </div>
    </section>

    <section className={styles.presetGrid}>
      {Object.values(EXPADIO_THEME_PRESETS).map((preset)=><button
        key={preset.key}
        type="button"
        className={selected===preset.key?styles.presetActive:styles.preset}
        onClick={()=>setSelected(preset.key)}
      >
        <span className={styles.swatches}>
          <i style={{background:preset[mode].primary}}/><i style={{background:preset[mode].secondary}}/><i style={{background:preset[mode].accent}}/>
        </span>
        <strong>{preset.name}</strong>
        <small>{preset.description}</small>
      </button>)}
    </section>

    <section className={styles.preview} style={{
      background:palette.canvas,color:palette.textPrimary,borderColor:palette.border,
    }}>
      <div className={styles.previewRail} style={{background:theme.shell[mode==='dark'?'sidebarSurfaceDark':'sidebarSurfaceLight'],borderColor:palette.border}}>
        <b>{theme.assets.brandName}</b><span style={{background:palette.accent}}>Command</span><span>Modules</span><span>Governance</span>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewTop} style={{background:palette.surface,borderColor:palette.border}}>Operational workspace</div>
        <div className={styles.previewCards}>
          <article style={{background:palette.surface,borderColor:palette.border}}><small>Active modules</small><strong>Live</strong></article>
          <article style={{background:palette.surface,borderColor:palette.border}}><small>Theme policy</small><strong>Governed</strong></article>
          <article style={{background:palette.surface,borderColor:palette.border}}><small>Accent</small><strong style={{color:palette.accent}}>{palette.accent}</strong></article>
        </div>
      </div>
    </section>

    <section className={styles.actionBar}>
      <div>{notice?<span role="status">{notice}</span>:<span>Publication appends a new immutable Platform profile.</span>}</div>
      <button type="button" disabled={!canPublish||busy} onClick={()=>void publish({presetKey:selected})}>
        {busy?'Publishing…':'Publish selected preset'}
      </button>
    </section>

    <section className={styles.history}>
      <h2>Version history</h2>
      {history.map((item)=><div key={item.recordVersion} className={styles.historyRow}>
        <div><strong>v{item.recordVersion} · {item.themeName}</strong><small>{new Date(item.authoredAt).toLocaleString()} · {item.reason}</small></div>
        <button type="button" disabled={!canPublish||busy||item.themeKey===effectiveTheme.key&&item.recordVersion===history[0]?.recordVersion} onClick={()=>void publish({rollbackRecordVersion:item.recordVersion,reason:'Rollback from Appearance Manager'})}>Restore as new version</button>
      </div>)}
    </section>
  </div>;
}
