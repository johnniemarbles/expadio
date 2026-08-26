import React from 'react';
import styles from '../../page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

export default async function WorkflowBlueprintsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const blueprints = await fetchApi<any[]>('/api/workflows/blueprints');
  
  if (isDenied(blueprints)) return <DeniedState result={blueprints} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Decision Fabric</p>
          <h1 id="page-title">Workflow Blueprints</h1>
          <p>Design and manage routing strategies, assignments, and orchestrated workflows.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="blueprints-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="blueprints-title">Available Blueprints</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Blueprint Key</th>
                <th>Display Name</th>
                <th>Status</th>
                <th>Version</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {blueprints.map((blueprint) => (
                <tr key={blueprint.blueprint_key}>
                  <td><span className={styles.code}>{blueprint.blueprint_key}</span></td>
                  <td><strong>{blueprint.display_name}</strong></td>
                  <td>
                    <StatePill state={blueprint.status === 'PUBLISHED' ? 'Published' : blueprint.status === 'DRAFT' ? 'Draft' : 'Review'} />
                  </td>
                  <td>v{blueprint.version}</td>
                  <td className={styles.muted}>{new Date(blueprint.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {blueprints.length === 0 && (
            <EmptyState title="No blueprints" description="No workflow blueprints are published in this tenant." />
          )}
        </div>
      </section>
    </>
  );
}
