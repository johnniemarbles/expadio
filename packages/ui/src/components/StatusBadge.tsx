import React from 'react';
import styles from './StatusBadge.module.css';
export type StatusTone='positive'|'warning'|'danger'|'info'|'neutral';
export function StatusBadge({children,tone='neutral'}:{children:React.ReactNode;tone?:StatusTone}){return <span className={[styles.badge,styles[tone]].join(' ')}>{children}</span>}
