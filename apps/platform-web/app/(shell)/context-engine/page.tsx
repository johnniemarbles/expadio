import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

export default async function ContextEnginePage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const contextData = await fetchApi<any>('/api/context-engine');
  
  if (isDenied(contextData)) return <DeniedState result={contextData} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Governance Center</p>
          <h1 id="page-title">Context Engine Inspector</h1>
          <p>Debug the context assembly engine for AI workloads.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="context-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="context-title">Latest Assembly Bundle: <span className={styles.code}>{contextData.bundleId}</span></h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Context Kind</th>
                <th>Objects Assembled</th>
              </tr>
            </thead>
            <tbody>
              {contextData.kinds.map((k: any) => (
                <tr key={k.kind}>
                  <td><strong>{k.kind}</strong></td>
                  <td>{k.count} items</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
