'use client';

import { useState } from 'react';
import styles from '../../workflows/page.module.css';

/**
 * The reviewer's cross-vertical inbox — every open governed instance waiting on
 * the signed-in participant to act, across case, vendor, expense and access
 * request. Oldest-waiting first; each row links through to the vertical where
 * the action is taken.
 */

export interface ReviewQueueItem {
  workTypeKey: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  state: string;
  currentStageKey: string;
  participantKey: string;
  revision: number;
  waitingSince: string;
}

// Where the work is actioned — each vertical owns its own console page.
const VERTICAL_HREF: Record<string, string> = {
  'crm.case': '/crm',
  'vendor.onboarding': '/vendors',
  'expense.reimbursement': '/expenses',
  'access.request': '/access-requests',
};

const sinceLabel = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

// The longer something waits on you, the louder the age reads.
const ageColor = (iso: string): string => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h >= 72) return '#b91c1c';
  if (h >= 24) return '#b45309';
  return '#64748b';
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };

export function ReviewQueueClient({ initial }: { initial: ReviewQueueItem[] }) {
  const [workType, setWorkType] = useState('');
  const workTypes = Array.from(new Set(initial.map((d) => d.workTypeKey))).sort();
  const rows = workType === '' ? initial : initial.filter((d) => d.workTypeKey === workType);

  return (
    <section className={styles.panel} aria-labelledby="rq-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Awaiting you</p><h2 id="rq-title">Your review queue</h2></div>
        <select style={inp} value={workType} onChange={(e) => setWorkType(e.target.value)} aria-label="Filter by work type">
          <option value="">All work types</option>
          {workTypes.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Nothing is waiting on you right now. Items appear here when a governed process stops on a stage assigned to you.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Work type</th><th>Subject</th><th>Stage</th><th>Your slot</th><th>Waiting</th><th></th></tr></thead>
            <tbody>
              {rows.map((d, i) => {
                const href = VERTICAL_HREF[d.workTypeKey];
                return (
                  <tr key={i}>
                    <td>{d.workTypeKey}</td>
                    <td>{d.subjectLabel ? <>{d.subjectLabel} <span style={{ color: '#94a3b8' }}>· {d.subjectType}</span></> : <>{d.subjectType} · <code>{d.subjectId.slice(0, 8)}</code></>}</td>
                    <td>{d.currentStageKey}</td>
                    <td>{d.participantKey}</td>
                    <td style={{ color: ageColor(d.waitingSince), fontWeight: 600 }}>{sinceLabel(d.waitingSince)}</td>
                    <td>{href ? <a href={href} style={{ color: '#2563eb', fontSize: 13 }}>Open</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
