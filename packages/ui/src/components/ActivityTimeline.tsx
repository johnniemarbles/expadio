import React from 'react';
import styles from './ActivityTimeline.module.css';
export interface ActivityTimelineItem { id: string; actor: string; action: string; target: string; time: string; timeLabel?: string; }
export interface ActivityTimelineProps { items: ActivityTimelineItem[]; className?: string; }
export function ActivityTimeline({ items, className = '' }: ActivityTimelineProps) {
  if (!items.length) return <div className={styles.empty}>No recent activity.</div>;
  return <ul className={[styles.timeline,className].join(' ')} aria-label="Activity timeline">{items.map((item,index) => <li key={item.id} className={styles.item}><div className={styles.nodeWrapper}><div className={styles.node} aria-hidden="true"/>{index !== items.length-1 && <div className={styles.line} aria-hidden="true"/>}</div><div className={styles.content}><p className={styles.text}><span className={styles.actor}>{item.actor}</span>{' '}<span className={styles.action}>{item.action}</span>{' '}<span className={styles.target}>{item.target}</span></p><time className={styles.time} dateTime={item.time}>{item.timeLabel ?? item.time}</time></div></li>)}</ul>;
}
