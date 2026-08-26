import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState, EmptyState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

export default async function AuthorizationPolicyInspectorPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const authTrace = await fetchApi<any>('/api/governance/authorization');
  
  if (isDenied(authTrace)) return <DeniedState result={authTrace} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance Center</p>
          <h1 id="page-title">Authorization Inspector</h1>
          <p>Debug the 9-stage pure authorization pipeline for access requests.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="trace-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="trace-title">Recent Evaluation Trace</h2>
          </div>
          <StatePill state={authTrace.decision === 'ALLOWED' ? 'Published' : 'Draft'} />
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {authTrace.stages.map((stage: any) => (
                <tr key={stage.name}>
                  <td><strong>{stage.name}</strong></td>
                  <td>
                    <StatePill state={stage.status === 'PASS' ? 'Published' : stage.status === 'FAIL' ? 'Draft' : 'Review'} />
                  </td>
                  <td className={styles.muted}>{stage.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
