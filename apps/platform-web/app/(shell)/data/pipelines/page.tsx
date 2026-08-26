import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

export default async function DataPipelinesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
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
              {pipelines.map((pipe) => (
                <tr key={pipe.id}>
                  <td><span className={styles.code}>{pipe.id}</span></td>
                  <td><strong>{pipe.name}</strong></td>
                  <td>
                    <StatePill state={pipe.status === 'SUCCEEDED' ? 'Published' : pipe.status === 'RUNNING' ? 'Review' : 'Draft'} />
                  </td>
                  <td className={styles.muted}>{pipe.currentStage} (of {pipe.totalStages})</td>
                </tr>
              ))}
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
