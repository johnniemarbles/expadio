import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../../lib/live-adapter';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../../lib/request-context';

function decisionClass(decision: string): string {
  const normalized = decision.toUpperCase();
  if (normalized === 'ALLOWED' || normalized === 'ALLOW') return [styles.statusBadge, styles.statusAllowed].join(' ');
  if (normalized === 'DENIED' || normalized === 'DENY' || normalized === 'BLOCKED') return [styles.statusBadge, styles.statusDenied].join(' ');
  if (normalized === 'PENDING' || normalized === 'EVALUATING') return [styles.statusBadge, styles.statusPending].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

function stageClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'PASS' || normalized === 'PASSED') return [styles.statusBadge, styles.statusPass].join(' ');
  if (normalized === 'FAIL' || normalized === 'FAILED') return [styles.statusBadge, styles.statusFail].join(' ');
  if (normalized === 'PENDING' || normalized === 'EVALUATING') return [styles.statusBadge, styles.statusPending].join(' ');
  return [styles.statusBadge, styles.statusNeutral].join(' ');
}

export default async function AuthorizationPolicyInspectorPage({ searchParams }: { searchParams: RouteSearchParams }) {
  await requestedOrganizationId(searchParams);
  const authTrace = await fetchApi<any>('/api/governance/authorization');
  
  if (isDenied(authTrace)) return <DeniedState result={authTrace} />;

  const decision = String(authTrace.decision ?? 'UNKNOWN');

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
          <span className={decisionClass(decision)}>{decision}</span>
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
              {authTrace.stages.map((stage: any) => {
                const status = String(stage.status ?? 'UNKNOWN');
                return (
                  <tr key={stage.name}>
                    <td><strong>{stage.name}</strong></td>
                    <td><span className={stageClass(status)}>{status}</span></td>
                    <td className={styles.muted}>{stage.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
