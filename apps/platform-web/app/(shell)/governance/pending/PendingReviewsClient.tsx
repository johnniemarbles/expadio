'use client';

import { useState } from 'react';
import styles from '../../workflows/page.module.css';

/**
 * Team-wide pending-review load — every open governed instance waiting on a
 * named person to act, and on whom, oldest-waiting first. The oversight
 * counterpart to a reviewer's personal queue: it answers "where is work piling
 * up, and who is the bottleneck". Filterable by work type and by assignee.
 */

export interface PendingReview {
  workTypeKey: string;
  subjectType: string;
  subjectId: string;
  state: string;
  currentStageKey: string;
  participantKey: string;
  assigneeSubjectId: string;
  waitingSince: string;
}

const sinceLabel = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const ageColor = (iso: string): string => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h >= 72) return '#b91c1c';
  if (h >= 24) return '#b45309';
  return '#64748b';
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };

export function PendingReviewsClient({ initial }: { initial: PendingReview[] }) {
  const [workType, setWorkType] = useState('');
  const [assignee, setAssignee] = useState('');

  const workTypes = Array.from(new Set(initial.map((d) => d.workTypeKey))).sort();
  const assignees = Array.from(new Set(initial.map((d) => d.assigneeSubjectId))).sort();
  const rows = initial.filter(
    (d) => (workType === '' || d.workTypeKey === workType) && (assignee === '' || d.assigneeSubjectId === assignee),
  );

  // How much is waiting on each person, for the "who is the bottleneck" read.
  const load = new Map<string, number>();
  for (const d of initial) load.set(d.assigneeSubjectId, (load.get(d.assigneeSubjectId) ?? 0) + 1);

  return (
    <section className={styles.panel} aria-labelledby="pr-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Oversight</p><h2 id="pr-title">Pending review load</h2></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={inp} value={workType} onChange={(e) => setWorkType(e.target.value)} aria-label="Filter by work type">
            <option value="">All work types</option>
            {workTypes.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
          </select>
          <select style={inp} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by assignee">
            <option value="">All assignees</option>
            {assignees.map((a) => <option key={a} value={a}>{a.slice(0, 12)} ({load.get(a)})</option>)}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          No governed work is waiting on a named reviewer right now.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Work type</th><th>Subject</th><th>Stage</th><th>Slot</th><th>Waiting on</th><th>Waiting</th></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={i}>
                  <td>{d.workTypeKey}</td>
                  <td>{d.subjectType} · <code>{d.subjectId.slice(0, 8)}</code></td>
                  <td>{d.currentStageKey}</td>
                  <td>{d.participantKey}</td>
                  <td><code>{d.assigneeSubjectId.slice(0, 12)}</code></td>
                  <td style={{ color: ageColor(d.waitingSince), fontWeight: 600 }}>{sinceLabel(d.waitingSince)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
