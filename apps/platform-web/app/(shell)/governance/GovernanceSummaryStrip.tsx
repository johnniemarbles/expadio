import React from 'react';
import { fetchApi } from '../../../lib/live-adapter';
import { isDenied } from '@expadio/ui/contracts';

/**
 * A compact KPI header for the Governance Center: how much governed work is
 * open, and how many decisions have been recorded, across every vertical. Links
 * through to the detailed in-flight and decision-log views. Server-rendered from
 * the RLS-scoped summary route; if the summary is denied it renders nothing so
 * the rest of the page is unaffected.
 */

interface Summary {
  openTotal: number;
  openByWorkType: { workTypeKey: string; count: number }[];
  decisionsTotal: number;
  decisionsByOutcome: { outcome: string; count: number }[];
}

const tile: React.CSSProperties = {
  border: '1px solid var(--line, #e2e8f0)', borderRadius: 12, padding: '14px 16px',
  background: 'var(--surface, #fff)', minWidth: 150, flex: '1 1 150px',
};
const num: React.CSSProperties = { fontSize: 26, fontWeight: 700, lineHeight: 1.1 };
const label: React.CSSProperties = { fontSize: 11, color: 'var(--ink-500, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 };
const chip: React.CSSProperties = { fontSize: 11, color: 'var(--ink-600, #475569)', marginRight: 8, whiteSpace: 'nowrap' };

export async function GovernanceSummaryStrip({ queryString = '' }: { queryString?: string }) {
  const summary = await fetchApi<Summary>(`/api/governance/summary${queryString}`);
  if (isDenied(summary)) return null;

  return (
    <section aria-label="Governed activity summary" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 20px' }}>
      <a href={`/governance/workflows${queryString}`} style={{ ...tile, textDecoration: 'none', color: 'inherit' }}>
        <div style={label}>In-flight work</div>
        <div style={num}>{summary.openTotal}</div>
        <div style={{ marginTop: 6 }}>
          {summary.openByWorkType.length === 0
            ? <span style={chip}>none open</span>
            : summary.openByWorkType.map((r) => <span key={r.workTypeKey} style={chip}>{r.workTypeKey.split('.')[0]} {r.count}</span>)}
        </div>
      </a>
      <a href={`/governance/decisions${queryString}`} style={{ ...tile, textDecoration: 'none', color: 'inherit' }}>
        <div style={label}>Decisions recorded</div>
        <div style={num}>{summary.decisionsTotal}</div>
        <div style={{ marginTop: 6 }}>
          {summary.decisionsByOutcome.length === 0
            ? <span style={chip}>none yet</span>
            : summary.decisionsByOutcome.map((r) => <span key={r.outcome} style={chip}>{r.outcome} {r.count}</span>)}
        </div>
      </a>
    </section>
  );
}
