'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ExpadioThemeDefinition, ThemeOverride } from '@expadio/ui';
import styles from './appearance.module.css';

type HistoryItem={recordVersion:number;authoredAt:string;reason:string;value:ThemeOverride};

export function BrandAppearanceManager({
  effectiveTheme,
  sourceLevel,
  canPublish,
  currentOverride,
  history,
}:{
  effectiveTheme:ExpadioThemeDefinition;
  sourceLevel:string;
  canPublish:boolean;
  currentOverride:ThemeOverride;
  history:readonly HistoryItem[];
}){
  const router=useRouter();
  const policy=effectiveTheme.overridePolicy;
  const [primary,setPrimary]=useState(currentOverride.primary??effectiveTheme.light.primary);
  const [secondary,setSecondary]=useState(currentOverride.secondary??effectiveTheme.light.secondary);
  const [accent,setAccent]=useState(currentOverride.accent??effectiveTheme.light.accent);
  const [brandName,setBrandName]=useState(currentOverride.brandName??effectiveTheme.assets.brandName);
  const [logoUrl,setLogoUrl]=useState(currentOverride.logoUrl??effectiveTheme.assets.logoUrl??'');
  const [mode,setMode]=useState<'light'|'dark'>('dark');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const preview=useMemo(()=>{
    const base=effectiveTheme[mode];
    return {...base,primary,secondary,accent,focus:accent};
  },[effectiveTheme,mode,primary,secondary,accent]);

  async function publish(body:Record<string,unknown>){
    setBusy(true);setNotice(null);
    try{
      const response=await fetch('/api/appearance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const payload=await response.json() as {denied?:boolean;message?:string;published?:{recordVersion:number}};
      if(!response.ok||payload.denied)throw new Error(payload.message??'Brand appearance publication failed.');
      setNotice('Published Brand appearance version '+payload.published?.recordVersion+'.');
      router.refresh();
    }catch(error){setNotice(error instanceof Error?error.message:'Brand appearance publication failed.')}
    finally{setBusy(false)}
  }

  function patch():ThemeOverride{
    return {
      ...(policy.allowPrimary?{primary}:{}),
      ...(policy.allowSecondary?{secondary}:{}),
      ...(policy.allowAccent?{accent}:{}),
      ...(policy.allowAssets?{brandName,...(logoUrl?{logoUrl}:{})}:{}),
    };
  }

  return <div className={styles.manager}>
    <section className={styles.summary}>
      <div><span>Effective source</span><strong>{sourceLevel}</strong></div>
      <div><span>Profile</span><strong>{effectiveTheme.name}</strong></div>
      <div><span>Override policy</span><strong>Platform governed</strong></div>
    </section>

    <section className={styles.editorGrid}>
      <div className={styles.editor}>
        <h2>Brand identity</h2>
        <label>Primary <span>{policy.allowPrimary?'Editable':'Locked'}</span><input type="color" value={primary} disabled={!policy.allowPrimary} onChange={(e)=>setPrimary(e.target.value)}/></label>
        <label>Secondary <span>{policy.allowSecondary?'Editable':'Locked'}</span><input type="color" value={secondary} disabled={!policy.allowSecondary} onChange={(e)=>setSecondary(e.target.value)}/></label>
        <label>Accent <span>{policy.allowAccent?'Editable':'Locked'}</span><input type="color" value={accent} disabled={!policy.allowAccent} onChange={(e)=>setAccent(e.target.value)}/></label>
        <label>Brand name <span>{policy.allowAssets?'Editable':'Locked'}</span><input type="text" value={brandName} disabled={!policy.allowAssets} onChange={(e)=>setBrandName(e.target.value)}/></label>
        <label>Logo URL <span>{policy.allowAssets?'Editable':'Locked'}</span><input type="url" value={logoUrl} disabled={!policy.allowAssets} onChange={(e)=>setLogoUrl(e.target.value)}/></label>
        <div className={styles.lockGrid}>
          <span>Typography <b>{policy.allowTypography?'Editable':'Locked by Platform'}</b></span>
          <span>Geometry <b>{policy.allowGeometry?'Editable':'Locked by Platform'}</b></span>
        </div>
      </div>

      <div>
        <div className={styles.modeSwitch}>
          <button type="button" aria-pressed={mode==='light'} onClick={()=>setMode('light')}>Light</button>
          <button type="button" aria-pressed={mode==='dark'} onClick={()=>setMode('dark')}>Dark</button>
        </div>
        <section className={styles.brandPreview} style={{background:preview.canvas,color:preview.textPrimary,borderColor:preview.border}}>
          <header style={{background:preview.surface,borderColor:preview.border}}><strong>{brandName||effectiveTheme.assets.brandName}</strong><span style={{color:preview.accent}}>Workspace</span></header>
          <div className={styles.previewHero}><small>BRAND OPERATIONS</small><h3>One governed experience across every module.</h3><p style={{color:preview.textSecondary}}>Modules contribute structure. Your approved identity is applied through semantic tokens.</p><button style={{background:preview.primary,color:preview.textInverse}}>Primary action</button></div>
        </section>
      </div>
    </section>

    <section className={styles.actionBar}>
      <div>{notice?<span role="status">{notice}</span>:<span>Only permitted fields are persisted. Protected Platform tokens remain inherited.</span>}</div>
      <div><button type="button" disabled={!canPublish||busy} onClick={()=>void publish({override:{},reason:'Reset Brand appearance to inherited Platform theme'})}>Reset overrides</button><button type="button" disabled={!canPublish||busy} onClick={()=>void publish({override:patch()})}>{busy?'Publishing…':'Publish Brand appearance'}</button></div>
    </section>

    <section className={styles.history}>
      <h2>Brand version history</h2>
      {history.length===0?<p>No Brand override has been published yet.</p>:history.map((item)=><div key={item.recordVersion} className={styles.historyRow}>
        <div><strong>v{item.recordVersion}</strong><small>{new Date(item.authoredAt).toLocaleString()} · {item.reason}</small></div>
        <button type="button" disabled={!canPublish||busy} onClick={()=>void publish({rollbackRecordVersion:item.recordVersion,reason:'Rollback Brand appearance from Appearance Manager'})}>Restore as new version</button>
      </div>)}
    </section>
  </div>;
}
