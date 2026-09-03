import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

function pipelineStatusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'SUCCEEDED' || normalized === 'COMPLETED') return [styles.statusBadge, styles.statusSuccess].join(' ');
  if (normalized === 'FAILED' || normalized === 'ERROR' || normalized === 'CANCELLED') return [styles.statusBadge, styles.statusDanger].join(' ');
  if (normalized === 'RUNNING' || normalized === 'PROCESSING' || normalized === 'EXECUTING') return [styles.statusBadge, styles.statusLive].join(' ');
  if (normalized === 'QUEUED' || normalized === 'PENDING' || normalized === 'WAITING') return [styles.statusBadge, styles.statusPending].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export default async function DataPipelinesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const pipelines = await fetchApi<any[]>('/api/data/pipelines');
  
  if (isDenied(pipelines)) return <DeniedState result={pipelines} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Operations</p>
          <h1 id="page-title">Data Intelligence Pipelines</h1>
          <p>Monitor multi-stage governed intelligence orchestration pipelines.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="pipelines-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="pipelines-title">Execution Monitor</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pipeline ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Current Stage</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map((pipe) => {
                const status = String(pipe.status ?? 'UNKNOWN');
                return (
                  <tr key={pipe.id}>
                    <td><span className={styles.code}>{pipe.id}</span></td>
                    <td><strong>{pipe.name}</strong></td>
                    <td><span className={pipelineStatusClass(status)}>{status}</span></td>
                    <td className={styles.muted}><span className={styles.stageProgress}>{pipe.currentStage} (of {pipe.totalStages})</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pipelines.length === 0 && (
            <EmptyState title="No active pipelines" description="No data orchestration pipelines are running." />
          )}
        </div>
      </section>
    </>
  );
}
