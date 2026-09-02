import React from 'react';
import styles from './PageHeader.module.css';

export function PageHeader({ title, eyebrow, description, actions }: {title:string;eyebrow?:string;description?:string;actions?:React.ReactNode}) {
  return <header className={styles.header}><div>{eyebrow?<p className={styles.eyebrow}>{eyebrow}</p>:null}<h1>{title}</h1>{description?<p className={styles.description}>{description}</p>:null}</div>{actions?<div className={styles.actions}>{actions}</div>:null}</header>;
}
