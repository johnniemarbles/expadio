'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './CommandPalette.module.css';

export interface CommandPaletteItem {
  readonly id:string;
  readonly label:string;
  readonly description?:string;
  readonly href:string;
  readonly keywords?:readonly string[];
  readonly group?:string;
}

export function CommandPalette({
  items,
  placeholder='Search commands and navigation…',
  triggerLabel='Search',
}:{
  items:readonly CommandPaletteItem[];
  placeholder?:string;
  triggerLabel?:string;
}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const [active,setActive]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);

  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return items;
    return items.filter((item)=>{
      const haystack=[item.label,item.description??'',item.group??'',...(item.keywords??[])].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  },[items,query]);

  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();
        setOpen(true);
        return;
      }
      if(event.key==='Escape'&&open){
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown',listener);
    return()=>document.removeEventListener('keydown',listener);
  },[open]);

  useEffect(()=>{
    if(!open)return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(()=>inputRef.current?.focus());
  },[open]);

  useEffect(()=>{
    if(active>=filtered.length)setActive(Math.max(0,filtered.length-1));
  },[active,filtered.length]);

  function execute(item:CommandPaletteItem){
    setOpen(false);
    window.location.assign(item.href);
  }

  return <>
    <button type="button" className={styles.trigger} onClick={()=>setOpen(true)} aria-haspopup="dialog">
      <span aria-hidden="true">⌕</span>
      <span>{triggerLabel}</span>
      <kbd>⌘K</kbd>
    </button>
    {open?<div className={styles.backdrop} role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setOpen(false)}}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.searchRow}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event)=>{setQuery(event.target.value);setActive(0)}}
            onKeyDown={(event)=>{
              if(event.key==='ArrowDown'){
                event.preventDefault();
                setActive((value)=>filtered.length?Math.min(value+1,filtered.length-1):0);
              }else if(event.key==='ArrowUp'){
                event.preventDefault();
                setActive((value)=>Math.max(value-1,0));
              }else if(event.key==='Enter'&&filtered[active]){
                event.preventDefault();
                execute(filtered[active]);
              }
            }}
            placeholder={placeholder}
            aria-label="Search commands"
            aria-controls="command-palette-results"
            aria-activedescendant={filtered[active]?`command-${filtered[active].id}`:undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div id="command-palette-results" className={styles.results} role="listbox" aria-label="Available commands">
          {filtered.length===0?<div className={styles.empty}>No matching navigation or commands.</div>:filtered.map((item,index)=>
            <button
              key={item.id}
              id={`command-${item.id}`}
              type="button"
              role="option"
              aria-selected={index===active}
              className={index===active?styles.active:styles.item}
              onMouseEnter={()=>setActive(index)}
              onClick={()=>execute(item)}
            >
              <span><strong>{item.label}</strong>{item.description?<small>{item.description}</small>:null}</span>
              {item.group?<em>{item.group}</em>:null}
            </button>
          )}
        </div>
        <footer className={styles.footer}><span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span></footer>
      </section>
    </div>:null}
  </>;
}
