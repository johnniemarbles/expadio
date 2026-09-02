import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

function workflowStateClass(state: string): string {
  const normalized = state.toUpperCase();
  if (normalized === 'COMPLETED' || normalized === 'SUCCEEDED') return [styles.statusBadge, styles.statusPositive].join(' ');
  if (normalized === 'FAILED' || normalized === 'ERROR' || normalized === 'CANCELLED' || normalized === 'BLOCKED') return [styles.statusBadge, styles.statusDanger].join(' ');
  if (normalized === 'ACTIVE' || normalized === 'RUNNING' || normalized === 'PROCESSING') return [styles.statusBadge, styles.statusLive].join(' ');
  if (normalized === 'PENDING' || normalized === 'WAITING' || normalized === 'PAUSED') return [styles.statusBadge, styles.statusWarning].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export default async function WorkflowConsolePage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const workflows = await fetchApi<any[]>('/api/workflows/instances');
  
  if (isDenied(workflows)) return <DeniedState result={workflows} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance Center</p>
          <h1 id="page-title">Workflow Engine</h1>
          <p>Monitor active business processes and stage transition bottlenecks.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="workflows-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="workflows-title">Active Instances</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Instance ID</th>
                <th>Blueprint ID</th>
                <th>Current Stage</th>
                <th>State</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => {
                const state = String(wf.state ?? 'UNKNOWN');
                return (
                  <tr key={wf.instance_id}>
                    <td><span className={styles.code}>{wf.instance_id.split('-')[0]}...</span></td>
                    <td><span className={styles.code}>{wf.blueprint_id}</span></td>
                    <td><strong>{wf.current_stage_key}</strong></td>
                    <td><span className={workflowStateClass(state)}>{state}</span></td>
                    <td className={styles.muted}>{new Date(wf.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {workflows.length === 0 && (
            <EmptyState title="No active workflows" description="There are no workflow instances running in this organization." />
          )}
        </div>
      </section>
    </>
  );
}
