import React from 'react';
import styles from './page.module.css';
import { fetchApi } from '../../../lib/live-adapter';
import { DeniedState, EmptyState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { requestedOrganizationId, type RouteSearchParams } from '../../../lib/request-context';

export default async function UsageMeteringPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const orgId = await requestedOrganizationId(searchParams);
  const usage = await fetchApi<any[]>('/api/usage/summary');
  
  if (isDenied(usage)) return <DeniedState result={usage} />;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Operations</p>
          <h1 id="page-title">Usage & Billing</h1>
          <p>Monitor your organization's intelligence usage against allocated budgets.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="usage-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="usage-title">Monthly Usage Summary</h2>
          </div>
        </div>
        
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Meter Kind</th>
                <th>Total Quantity</th>
                <th>Event Count</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((meter) => (
                <tr key={meter.meter_kind}>
                  <td><strong>{meter.meter_kind}</strong></td>
                  <td>{parseInt(meter.total_quantity, 10).toLocaleString()}</td>
                  <td className={styles.muted}>{parseInt(meter.event_count, 10).toLocaleString()} events</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.length === 0 && (
            <EmptyState title="No usage data" description="No intelligence usage recorded for this billing period." />
          )}
        </div>
      </section>
    </>
  );
}
