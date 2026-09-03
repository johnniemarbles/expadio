import Link from 'next/link';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';
import LeadAnalyticsClient from './LeadAnalyticsClient';

export const dynamic = 'force-dynamic';

export default async function LeadAnalyticsPage() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) =>
    loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'lead-management' }),
  );

  if (module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div><p className={styles.eyebrow}>Growth</p><h1>Lead Analytics</h1></div>
          <Link className={styles.secondaryButton} href="/leads">Back to leads</Link>
        </section>
        <div className={styles.notice}><strong>Lead Management is not active for this tenant.</strong></div>
      </>
    );
  }

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · {context.organizationName}</p>
          <h1>Lead Analytics</h1>
          <p>Hierarchy-safe funnel, task queue, and attribution rollups across the organization subtree.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className={styles.secondaryButton} href="/leads/capture">Demand Capture</Link>
          <Link className={styles.secondaryButton} href="/leads">CRM leads</Link>
        </div>
      </section>
      <LeadAnalyticsClient />
    </>
  );
}
