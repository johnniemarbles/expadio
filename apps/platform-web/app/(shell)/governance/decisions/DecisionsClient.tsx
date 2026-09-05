'use client';

import { useState } from 'react';
import { findIndustryPack, resolveWorkTypeLabel, resolveStageLabel } from '@expadio/industry-packs';
import styles from '../../workflows/page.module.css';

/**
 * The governed-decision oversight log. Every immutable stage decision across all
 * verticals in one tenant-wide, filterable table — the compliance complement to
 * the per-subject workflow trace.
 */

export interface GovernedDecision {
  decidedAt: string;
  workTypeKey: string;
  subjectType: string;
  subjectId: string;
  stageKey: string;
  outcome: string;
  decidedBySubjectId: string;
  code: string;
  evidenceRefs: string[];
  instanceState: string;
}

const outcomeColor = (o: string): string => {
  const up = o.toUpperCase();
  if (up.includes('APPROVE')) return 'var(--theme-success)';
  if (up.includes('REJECT') || up.includes('DENY') || up.includes('RETURN')) return 'var(--theme-danger)';
  return 'var(--theme-text-secondary)';
};

const inp: React.CSSProperties = { padding: '8px 12px', border: '1px solid var(--line, #cbd5e1)', borderRadius: "var(--theme-radius-card)", fontSize: 13 };

export function DecisionsClient({ initial, verticalKey = null, queryString = '' }: { initial: GovernedDecision[]; verticalKey?: string | null; queryString?: string }) {
  const pack = findIndustryPack(verticalKey);
  const [rows, setRows] = useState<GovernedDecision[]>(initial);
  const [workType, setWorkType] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function apply(next: string) {
    setWorkType(next);
    setError(null);
    const sep = queryString ? '&' : '?';
    const wt = next.trim() !== '' ? `${sep}workType=${encodeURIComponent(next.trim())}` : '';
    try {
      const res = await fetch(`/api/governance/decisions${queryString}${wt}`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not load decisions.');
      setRows(Array.isArray(data.decisions) ? data.decisions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load decisions.');
    }
  }

  const workTypes = Array.from(new Set(initial.map((d) => d.workTypeKey))).sort();

  return (
    <section className={styles.panel} aria-labelledby="decisions-title">
      <div className={styles.panelHeading}>
        <div><p className={styles.eyebrow}>Oversight</p><h2 id="decisions-title">Governed decisions</h2></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={inp} value={workType} onChange={(e) => apply(e.target.value)} aria-label="Filter by work type">
            <option value="">All work types</option>
            {workTypes.map((wt) => <option key={wt} value={wt}>{resolveWorkTypeLabel(pack, wt)}</option>)}
          </select>
          <a
            href={`/api/governance/decisions/export${(() => {
              const sep = queryString ? '&' : '?';
              return `${queryString}${workType.trim() !== '' ? `${sep}workType=${encodeURIComponent(workType.trim())}` : ''}`;
            })()}`}
            style={{ ...inp, textDecoration: 'none', color: 'var(--theme-primary)', whiteSpace: 'nowrap' }}
          >
            Download CSV
          </a>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'var(--theme-danger)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>When</th><th>Work type</th><th>Subject</th><th>Stage</th><th>Outcome</th><th>By</th><th>Evidence</th></tr></thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.decidedAt).toLocaleString()}</td>
                <td title={pack ? d.workTypeKey : undefined}>{resolveWorkTypeLabel(pack, d.workTypeKey)}</td>
                <td><span className={styles.muted}>{d.subjectType}</span><br />{d.subjectId.slice(0, 8)}…</td>
                <td title={pack ? d.stageKey : undefined}>{resolveStageLabel(pack, d.workTypeKey, d.stageKey)}</td>
                <td><strong style={{ color: outcomeColor(d.outcome) }}>{d.outcome}</strong></td>
                <td>{d.decidedBySubjectId}</td>
                <td>
                  {d.evidenceRefs.length === 0 ? <span className={styles.muted}>—</span> : d.evidenceRefs.map((ref) => (
                    <code key={ref} style={{ fontSize: 10, color: 'var(--ink-500, #64748b)', background: 'var(--surface-2, #f1f5f9)', padding: '1px 5px', borderRadius: "var(--theme-radius-card)", marginRight: 4, display: 'inline-block', marginBottom: 2 }}>{ref}</code>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No governed decisions recorded yet.</p>}
      </div>
    </section>
  );
}
