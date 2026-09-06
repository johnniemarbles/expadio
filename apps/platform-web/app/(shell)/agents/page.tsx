import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

function statusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'SUCCEEDED' || normalized === 'COMPLETED') return [styles.statusBadge, styles.statusSuccess].join(' ');
  if (normalized === 'FAILED' || normalized === 'CANCELLED') return [styles.statusBadge, styles.statusDanger].join(' ');
  if (normalized === 'RUNNING' || normalized === 'PROCESSING') return [styles.statusBadge, styles.statusLive].join(' ');
  if (normalized === 'QUEUED' || normalized === 'PENDING') return [styles.statusBadge, styles.statusPending].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export default async function AgentRunsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const runs = await fetchApi<any[]>('/api/agent/runs');
  
  if (isDenied(runs)) return <DeniedState result={runs} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Agent Intelligence</p>
          <h1 id="page-title">Agent Runs & Budget</h1>
          <p>Monitor autonomous agent execution runs and token budget consumption.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="runs-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="runs-title">Recent Executions</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent Identity</th>
                <th>Session ID</th>
                <th>Status</th>
                <th>Total Cost</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.session_id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{run.display_name || run.agent_id}</div>
                    <div className={styles.muted} style={{ fontSize: 11, marginTop: 2 }}>{run.department || 'System'}</div>
                  </td>
                  <td><span className={styles.code}>{run.session_id.slice(0,8)}...</span></td>
                  <td><span className={statusClass(String(run.status ?? 'UNKNOWN'))}>{String(run.status ?? 'UNKNOWN')}</span></td>
                  <td>{run.total_cost_minor_units > 0 ? `$${(run.total_cost_minor_units / 1000000).toFixed(4)}` : '-'}</td>
                  <td className={styles.muted}>{new Date(run.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 && (
            <EmptyState title="No agent runs" description="No autonomous agents have executed in this organization yet." />
          )}
        </div>
      </section>
    </>
  );
}
