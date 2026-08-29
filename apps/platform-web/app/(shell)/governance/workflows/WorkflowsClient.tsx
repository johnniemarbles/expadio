'use client';

import { useState } from 'react';
import styles from '../../workflows/page.module.css';

/**
 * In-flight governed work across all verticals — the oversight companion to the
 * governed-decision log. Shows every open workflow instance, the stage it sits
 * at, and how long since it last moved, filterable by work type.
 */

export interface GovernedInstance {
  workTypeKey: string;
  subjectType: string;
  subjectId: string;
  state: string;
  currentStageKey: string | null;
  revision: number;
  startedAt: string | null;
  updatedAt: string;
}

const stateColor = (s: string): string => {
  const up = s.toUpperCase();
  if (up === 'RUNNING') return '#0f766e';
  if (up === 'PAUSED') return '#b45309';
  if (up === 'CREATED') return '#2563eb';
  return '#64748b';
};

const sinceLabel = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(0, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: 8, fontSize: 13 };

export function WorkflowsClient({ initial, queryString = '' }: { initial: GovernedInstance[]; queryString?: string }) {
  const [rows, setRows] = useState<GovernedInstance[]>(initial);
  const [workType, setWorkType] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function apply(next: string) {
    setWorkType(next);
    setError(null);
    const sep = queryString ? '&' : '?';
    const wt = next.trim() !== '' ? `${sep}workType=${encodeURIComponent(next.trim())}` : '';
    try {
      const res = await fetch(`/api/governance/workflows${queryString}${wt}`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not load workflows.');
      setRows(Array.isArray(data.instances) ? data.instances : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load workflows.');
    }
  }

  const workTypes = Array.from(new Set(initial.map((d) => d.workTypeKey))).sort();

  return (
    <section className={styles.panel} aria-labelledby="wf-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Oversight</p><h2 id="wf-title">In-flight work</h2></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={inp} value={workType} onChange={(e) => apply(e.target.value)} aria-label="Filter by work type">
            <option value="">All work types</option>
            {workTypes.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
          </select>
          <a
            href={`/api/governance/workflows/export${(() => {
              const sep = queryString ? '&' : '?';
              return `${queryString}${workType.trim() !== '' ? `${sep}workType=${encodeURIComponent(workType.trim())}` : ''}`;
            })()}`}
            style={{ ...inp, textDecoration: 'none', color: '#2563eb', whiteSpace: 'nowrap' }}
          >
            Download CSV
          </a>
        </div>
      </div>

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Work type</th><th>Subject</th><th>Stage</th><th>State</th><th>Rev</th><th>Idle</th></tr></thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={i}>
                <td>{d.workTypeKey}</td>
                <td><span className={styles.muted}>{d.subjectType}</span><br />{d.subjectId.slice(0, 8)}…</td>
                <td>{d.currentStageKey ?? <span className={styles.muted}>—</span>}</td>
                <td><strong style={{ color: stateColor(d.state) }}>{d.state}</strong></td>
                <td>{d.revision}</td>
                <td title={new Date(d.updatedAt).toLocaleString()}>{sinceLabel(d.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No in-flight workflows — every governed process is either not yet started or completed.</p>}
      </div>
    </section>
  );
}
