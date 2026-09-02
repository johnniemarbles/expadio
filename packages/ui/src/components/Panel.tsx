import React from 'react';
import styles from './Panel.module.css';

export function Panel({ children, className='' }: {children:React.ReactNode;className?:string}) {
  return <section className={[styles.panel,className].filter(Boolean).join(' ')}>{children}</section>;
}
export function PanelHeader({ title, eyebrow, description, actions }: {title:string;eyebrow?:string;description?:string;actions?:React.ReactNode}) {
  return <header className={styles.header}><div>{eyebrow?<p className={styles.eyebrow}>{eyebrow}</p>:null}<h2>{title}</h2>{description?<p className={styles.description}>{description}</p>:null}</div>{actions?<div className={styles.actions}>{actions}</div>:null}</header>;
}
export function PanelBody({ children, className='' }: {children:React.ReactNode;className?:string}) {
  return <div className={[styles.body,className].filter(Boolean).join(' ')}>{children}</div>;
}
