'use client';

import Link from 'next/link';
import type { ModuleShellDescriptor } from '@expadio/ui';
import { usePathname } from 'next/navigation';
import styles from '../app/(workspace)/workspace.module.css';

function active(pathname:string,href:string){
  return href==='/'?pathname==='/':pathname===href||pathname.startsWith(href+'/');
}

export function ModuleWorkspaceFrame({
  descriptor,
  children,
}:{
  descriptor:ModuleShellDescriptor;
  children:React.ReactNode;
}){
  const pathname=usePathname();
  const primary=descriptor.sections.filter((item)=>item.placement==='primary');
  const more=descriptor.sections.filter((item)=>item.placement==='more');
  return <div className={styles.moduleViewport}>
    <header className={styles.moduleHeader}>
      <div><p className={styles.eyebrow}>App</p><h1>{descriptor.name}</h1><p>{descriptor.description}</p></div>
    </header>
    {descriptor.sections.length>0?<nav className={styles.moduleTabs} aria-label={descriptor.name+' sections'}>
      {primary.map((item)=><Link key={item.id} href={item.href} className={active(pathname,item.href)?styles.moduleTabActive:''}>{item.label}</Link>)}
      {more.length>0?<details className={styles.moreMenu}>
        <summary className={more.some((item)=>active(pathname,item.href))?styles.moduleTabActive:''}>More</summary>
        <div>{more.map((item)=><Link key={item.id} href={item.href}>{item.label}</Link>)}</div>
      </details>:null}
    </nav>:null}
    <div className={styles.moduleBody}>{children}</div>
  </div>;
}
